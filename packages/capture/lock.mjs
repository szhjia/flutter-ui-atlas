import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const LOCK_DIR_NAME = '.atlas-lock';
const EMPTY_LOCK_GRACE_MS = 60_000;
const GUARD_WAIT_MS = 1_000;
export const lockPath = output => resolve(output, LOCK_DIR_NAME);
const guardPath = output => resolve(output, '.atlas-lock-guard');

async function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function busyError(lock, holderPid) {
  const holder = holderPid === undefined ? '' : `，持有进程 PID ${holderPid}`;
  return Error(`采集输出目录正被另一个写入任务使用（锁：${lock}${holder}）。若该任务已退出，删除该锁目录后重试。`);
}

/**
 * 不自动接管互斥门：任何检查后删除的接管都会重开竞争窗口。
 * 仅在门内修改批次锁；门内崩溃时保留现场，由明确的人工恢复处理。
 */
async function withGuard(output, action) {
  const guard = guardPath(output);
  const deadline = Date.now() + GUARD_WAIT_MS;
  for (;;) {
    try {
      await mkdir(guard);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw Error(
          `输出锁互斥门被占用（${guard}）。请等待后重试；若进程已退出，请确认相关写入任务均已停止，再删除该互斥门目录后重试。`
        );
      }
      await delay(10);
    }
  }
  try {
    await writeFile(resolve(guard, 'meta.json'), JSON.stringify({pid: process.pid}));
    return await action();
  } finally {
    await rm(guard, {recursive: true, force: true});
  }
}

async function inspectLock(lock, now) {
  let pid;
  try {
    const meta = JSON.parse(await readFile(resolve(lock, 'meta.json'), 'utf8'));
    if (Number.isInteger(meta.pid) && meta.pid > 0) pid = meta.pid;
  } catch {
    // meta 缺失或不可读：下方 stat 区分空锁与不存在的目录。
  }
  if (pid !== undefined) return {stale: !(await pidAlive(pid)), holderPid: pid};
  try {
    const {mtimeMs} = await stat(lock);
    return {stale: now() - mtimeMs > EMPTY_LOCK_GRACE_MS, holderPid: undefined};
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** 获取与释放共用同一互斥门，陈旧检查、删除与新持有者登记不可被其他写入者交错。 */
export async function acquireOutputLock(output, {warn = console.warn, now = Date.now} = {}) {
  const lock = lockPath(output);
  const token = randomUUID();
  await mkdir(output, {recursive: true});
  await withGuard(output, async () => {
    const observed = await inspectLock(lock, now);
    if (observed) {
      if (!observed.stale) throw busyError(lock, observed.holderPid);
      warn(
        `检测到陈旧输出锁${observed.holderPid === undefined ? '（无持有信息，超过宽限时间）' : `（持有进程 ${observed.holderPid} 已退出）`}，自动接管：${lock}`
      );
      await rm(lock, {recursive: true, force: true});
    }
    await mkdir(lock);
    try {
      await writeFile(
        resolve(lock, 'meta.json'),
        JSON.stringify({pid: process.pid, token, acquiredAt: new Date(now()).toISOString()})
      );
    } catch (error) {
      await rm(lock, {recursive: true, force: true}).catch(() => {});
      throw error;
    }
  });
  let released;
  return () => {
    if (released) return released;
    released = withGuard(output, async () => {
      let meta;
      try {
        meta = JSON.parse(await readFile(resolve(lock, 'meta.json'), 'utf8'));
      } catch {
        // 无法证明所有权时保留目录，不能把未知锁当成自己的残留。
        return;
      }
      if (meta.pid === process.pid && meta.token === token) await rm(lock, {recursive: true, force: true});
    }).catch(error => {
      // 门暂时不可用时允许调用方稍后重试，不能缓存失败而永久遗留自己的批次锁。
      released = undefined;
      throw error;
    });
    return released;
  };
}
