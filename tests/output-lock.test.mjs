import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, readFile, rm, utimes} from 'node:fs/promises';
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
