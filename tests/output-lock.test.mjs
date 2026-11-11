import test from 'node:test';
import assert from 'node:assert/strict';
import {fork, spawnSync} from 'node:child_process';
import {once, on} from 'node:events';
import {mkdir, readFile, rm, utimes, writeFile} from 'node:fs/promises';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireOutputLock, lockPath} from '../packages/capture/lock.mjs';
import {runDiscovery} from '../packages/capture/discovery.mjs';
import {capture} from '../packages/capture/index.mjs';

const output = async () => mkdtemp(join(tmpdir(), 'atlas-lock-'));
const deadPid = () => {
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.equal(child.status, 0);
  return child.pid;
};

test('获取写 meta 并释放删除，释放幂等', async () => {
  const dir = await output();
  const release = await acquireOutputLock(dir);
  const meta = JSON.parse(await readFile(join(lockPath(dir), 'meta.json'), 'utf8'));
  assert.equal(meta.pid, process.pid);
  await release();
  await release();
  await assert.rejects(readFile(join(lockPath(dir), 'meta.json')));
});

test('活锁拒绝：错误含锁绝对路径、持有 PID 与清理指引', async () => {
  const dir = await output();
  const release = await acquireOutputLock(dir);
  await assert.rejects(acquireOutputLock(dir), error => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(lockPath(dir)), '应含锁绝对路径');
    assert.ok(error.message.includes(`PID ${process.pid}`), '应含持有 PID');
    assert.ok(error.message.includes('删除该锁目录'), '应含清理指引');
    return true;
  });
  await release();
  const again = await acquireOutputLock(dir);
  await again();
});

test('死 PID 陈旧锁自动接管并告警', async () => {
  const dir = await output();
  const pid = deadPid();
  await mkdir(lockPath(dir));
  const {writeFile} = await import('node:fs/promises');
  await writeFile(join(lockPath(dir), 'meta.json'), JSON.stringify({pid, acquiredAt: new Date().toISOString()}));
  const warnings = [];
  const release = await acquireOutputLock(dir, {warn: message => warnings.push(message)});
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('陈旧'));
  assert.ok(warnings[0].includes(String(pid)));
  assert.ok(warnings[0].includes(lockPath(dir)));
  await release();
});

test('无 meta 空锁目录：超过宽限自动接管，宽限内拒绝', async () => {
  const dir = await output();
  await mkdir(lockPath(dir));
  const stale = new Date(Date.now() - 120_000);
  await utimes(lockPath(dir), stale, stale);
  const warnings = [];
  const release = await acquireOutputLock(dir, {warn: message => warnings.push(message)});
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('宽限'));
  await release();

  await mkdir(lockPath(dir));
  await assert.rejects(acquireOutputLock(dir), error => {
    assert.ok(error.message.includes('删除该锁目录'));
    return true;
  });
  await rm(lockPath(dir), {recursive: true, force: true});
});

test('接入：活锁下 runDiscovery 与 capture 在启动任何工作前即拒绝', async () => {
  const discoveryDir = await output();
  const release = await acquireOutputLock(discoveryDir);
  const boom = () => {
    throw Error('不应启动浏览器');
  };
  await assert.rejects(
    runDiscovery({
      discovery: {},
      launchBrowser: boom,
      output: discoveryDir,
      publicPath: '/generated',
      viewport: {width: 1, height: 1},
      mode: 'manual'
    }),
    error => {
      assert.ok(error.message.includes(lockPath(discoveryDir)), 'runDiscovery 应因锁拒绝');
      return true;
    }
  );
  await assert.rejects(capture({adapter: {}, launchBrowser: boom, output: discoveryDir}), error => {
    assert.ok(error.message.includes(lockPath(discoveryDir)), 'capture 应因锁拒绝');
    return true;
  });
  await release();
});

test('release 不删除他人持有的锁（meta.pid 非本进程时保留目录）', async () => {
  const dir = await output();
  const release = await acquireOutputLock(dir);
  const {writeFile} = await import('node:fs/promises');
  const holder = process.pid + 1;
  await writeFile(
    join(lockPath(dir), 'meta.json'),
    JSON.stringify({pid: holder, acquiredAt: new Date().toISOString()})
  );
  await release();
  const meta = JSON.parse(await readFile(join(lockPath(dir), 'meta.json'), 'utf8'));
  assert.equal(meta.pid, holder, '他人的活锁不应被本进程 release 删除');
  await rm(lockPath(dir), {recursive: true, force: true});
});

test('集成：陈旧锁自动接管后 runDiscovery 走完批次并释放锁', async () => {
  const dir = await output();
  const pid = deadPid();
  await mkdir(lockPath(dir));
  const {writeFile} = await import('node:fs/promises');
  await writeFile(join(lockPath(dir), 'meta.json'), JSON.stringify({pid, acquiredAt: new Date().toISOString()}));
  await assert.rejects(
    runDiscovery({
      discovery: {
        candidates: async () => [],
        sourceFingerprint: async () => 'f',
        open: async () => {
          throw Error('不应打开浏览器页面');
        }
      },
      launchBrowser: async () => ({close: async () => {}}),
      output: dir,
      publicPath: '/generated',
      viewport: {width: 1, height: 1},
      mode: 'capture'
    }),
    error => {
      assert.ok(error.message.includes('目录不能为空'), '空目录批次按既有语义失败');
      return true;
    }
  );
  const takenAgain = await acquireOutputLock(dir);
  await takenAgain();
});

function worker(t, dir, resumeFile = '') {
  const child = fork(new URL('./fixtures/output-lock-worker.mjs', import.meta.url), [dir, resumeFile], {silent: true});
  child.stdout.resume();
  child.stderr.resume();
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  return child;
}

async function outcome(child) {
  for await (const [message] of on(child, 'message')) {
    if (message.event === 'acquired' || message.event === 'denied') return message;
  }
}

test('两个真实进程接管同一陈旧锁时，检查与新持有者登记不可交错', {timeout: 15_000}, async t => {
  const dir = await output();
  const resume = join(dir, 'resume');
  await mkdir(lockPath(dir));
  await writeFile(join(lockPath(dir), 'meta.json'), JSON.stringify({pid: deadPid()}));
  const first = worker(t, dir, resume);
  const firstOutcome = outcome(first);
  assert.equal((await once(first, 'message'))[0].event, 'warning');
  // 第一个进程停在陈旧判定之后；第二个进程必须不能趁机取得锁。
  const second = worker(t, dir);
  const secondOutcome = await outcome(second);
  await writeFile(resume, '');
  assert.equal((await firstOutcome).event, 'acquired');
  assert.equal(secondOutcome.event, 'denied');
  assert.match(secondOutcome.message, /锁|互斥门/);
  const closed = once(first, 'exit');
  first.send('release');
  assert.equal((await closed)[0], 0);
  await assert.rejects(readFile(join(lockPath(dir), 'meta.json')), {code: 'ENOENT'});
});

test('无锁目录的跨进程竞争也只有一个持有者', {timeout: 10_000}, async t => {
  const dir = await output();
  const children = [worker(t, dir), worker(t, dir)];
  const results = await Promise.all(children.map(outcome));
  assert.equal(results.filter(result => result.event === 'acquired').length, 1);
  const winner = children[results.findIndex(result => result.event === 'acquired')];
  const closed = once(winner, 'exit');
  winner.send('release');
  assert.equal((await closed)[0], 0);
});

test('锁修改中进程崩溃时保留互斥门并提供人工恢复路径，清理后可以接管', {timeout: 10_000}, async t => {
  const dir = await output();
  const guard = join(dir, '.atlas-lock-guard');
  await mkdir(lockPath(dir));
  await writeFile(join(lockPath(dir), 'meta.json'), JSON.stringify({pid: deadPid()}));
  const child = worker(t, dir, join(dir, 'never-resume'));
  await once(child, 'message');
  const closed = once(child, 'exit');
  child.kill('SIGKILL');
  await closed;
  await assert.rejects(acquireOutputLock(dir), error => {
    assert.ok(error.message.includes(guard));
    assert.match(error.message, /确认相关写入任务均已停止/);
    return true;
  });
  await readFile(join(guard, 'meta.json'));
  await rm(guard, {recursive: true});
  const release = await acquireOutputLock(dir, {warn: () => {}});
  await release();
});

test('release 不能删除同 PID 的新一代锁或身份不可读的锁', async () => {
  for (const replacement of [JSON.stringify({pid: process.pid, token: 'new-owner'}), '{bad']) {
    const dir = await output();
    const release = await acquireOutputLock(dir);
    const metaPath = join(lockPath(dir), 'meta.json');
    await writeFile(metaPath, replacement);
    await release();
    assert.equal(await readFile(metaPath, 'utf8'), replacement);
    await rm(lockPath(dir), {recursive: true});
  }
});

test('release 遇到互斥门占用失败后可以重试，不永久缓存失败结果', async () => {
  const dir = await output();
  const release = await acquireOutputLock(dir);
  const guard = join(dir, '.atlas-lock-guard');
  await mkdir(guard);
  await assert.rejects(release(), /互斥门/);
  await rm(guard, {recursive: true});
  await release();
  await assert.rejects(readFile(join(lockPath(dir), 'meta.json')), {code: 'ENOENT'});
  const next = await acquireOutputLock(dir);
  await next();
});
