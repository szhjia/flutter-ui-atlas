import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const LOCK_DIR_NAME = '.atlas-lock';
/** 无 meta 的空锁目录（mkdir 后、写 meta 前被杀的窗口）超过该宽限时间视为陈旧。 */
const EMPTY_LOCK_GRACE_MS = 60_000;
/** 同一次获取中允许的陈旧接管次数上限，防病态场景下无限互相清理。 */
const MAX_TAKEOVERS = 3;

export const lockPath = output => resolve(output, LOCK_DIR_NAME);

async function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM：进程存在但属于其他用户，按存活处理，避免误抢活锁。
    return error.code === 'EPERM';
  }
}

function busyError(lock, holderPid) {
  const holder = holderPid === undefined ? '' : `，持有进程 PID ${holderPid}`;
  return Error(`采集输出目录正被另一个写入任务使用（锁：${lock}${holder}）。若该任务已退出，删除该锁目录后重试。`);
}

/**
 * 检查已存在的锁目录是否陈旧。
 * 陈旧 = meta.pid 已退出，或无 meta（不可读）且目录 mtime 超过宽限时间。
 * 返回 {stale, holderPid}；holderPid 仅用于拒绝文案。
 */
async function inspectLock(lock, now) {
  let pid;
  try {
    const meta = JSON.parse(await readFile(resolve(lock, 'meta.json'), 'utf8'));
    if (Number.isInteger(meta.pid)) pid = meta.pid;
  } catch {
    // meta 缺失或不可读：落入 mtime 宽限判定。
  }
  if (pid !== undefined) {
    return {stale: !(await pidAlive(pid)), holderPid: pid};
  }
  const {mtimeMs} = await stat(lock);
  return {stale: now() - mtimeMs > EMPTY_LOCK_GRACE_MS, holderPid: undefined};
}

async function writeHolderMeta(lock, now) {
  await writeFile(
    resolve(lock, 'meta.json'),
    JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date(now()).toISOString()
    })
  );
}

/**
 * 释放自己持有的锁。meta 可读且 pid 非本进程时不动目录——竞争接管中误删他人活锁会级联破坏互斥；
 * meta 缺失或不可读时仍删除：自己的半成品锁不该滞留宽限期。
 */
async function releaseLock(lock) {
  try {
    const meta = JSON.parse(await readFile(resolve(lock, 'meta.json'), 'utf8'));
    if (Number.isInteger(meta.pid) && meta.pid !== process.pid) return;
  } catch {
    // meta 缺失或损坏：按自己的残留锁处理。
  }
  await rm(lock, {recursive: true, force: true});
}

/**
 * 获取 output 目录的写入锁（capture 与 runDiscovery 共用）。返回幂等的 release()。
 * 陈旧锁自动接管（打告警）：接管删除前复核一次，判定与删除之间被其他进程抢先时重新走获取流程；
 * 活锁或宽限内的空锁直接拒绝，错误含锁绝对路径与清理指引。
 */
export async function acquireOutputLock(output, {warn = console.warn, now = Date.now} = {}) {
  const lock = lockPath(output);
  await mkdir(output, {recursive: true});
  let takeovers = 0;
  for (;;) {
    try {
      await mkdir(lock);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const observed = await inspectLock(lock, now);
      if (!observed.stale) throw busyError(lock, observed.holderPid);
      const recheck = await inspectLock(lock, now);
      if (!recheck.stale) continue;
      warn(
        `检测到陈旧输出锁${observed.holderPid === undefined ? '（无持有信息，超过宽限时间）' : `（持有进程 ${observed.holderPid} 已退出）`}，自动接管：${lock}`
      );
      await rm(lock, {recursive: true, force: true});
      if (++takeovers > MAX_TAKEOVERS) {
        throw Error(`输出锁反复被判定为陈旧（${lock}），请人工检查该目录后重试。`);
      }
      continue;
    }
    try {
      await writeHolderMeta(lock, now);
    } catch (error) {
      // meta 写不进去的锁不可判定陈旧，清掉重抛，不让半成品锁残留。
      await rm(lock, {recursive: true, force: true}).catch(() => {});
      throw error;
    }
    let released = false;
    return () => {
      if (released) return Promise.resolve();
      released = true;
      return releaseLock(lock);
    };
  }
}
