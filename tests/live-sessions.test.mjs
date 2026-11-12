import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createLiveSessionManager} from '../packages/cli/live-sessions.mjs';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return {promise, resolve};
};
function resource() {
  const page = new EventEmitter();
  let count = 0;
  return {
    page,
    close: async () => {
      count++;
    },
    get count() {
      return count;
    }
  };
}
const input = requestId => ({screenId: 'home', captureId: 'capture', requestId});
test('替换、旧请求关闭和手动关闭只释放所属资源一次', async () => {
  const first = resource();
  const second = resource();
  let calls = 0;
  const manager = createLiveSessionManager({openSession: async () => (++calls === 1 ? first : second)});
  const a = await manager.open(input('a'));
  const b = await manager.open(input('b'));
  assert.equal(first.count, 1);
  await manager.close(a.id);
  assert.equal(second.count, 0);
  assert.equal(manager.status().id, b.id);
  second.page.emit('close');
  await manager.close();
  assert.equal(second.count, 1);
  assert.equal(manager.status().state, 'idle');
  await manager.shutdown();
});
test('取消准备中的旧会话会中止等待，迟到资源不会覆盖或关闭新会话', async () => {
  const pending = deferred();
  const first = resource();
  const second = resource();
  let signal;
  const manager = createLiveSessionManager({
    openSession: ({requestId, ...args}) => {
      if (!signal) {
        signal = args.signal;
        return pending.promise;
      }
      return Promise.resolve(second);
    }
  });
  const a = manager.open(input('a'));
  const rejected = assert.rejects(a, /取消/);
  await new Promise(done => setImmediate(done));
  await manager.close('a');
  assert.equal(signal.aborted, true);
  await rejected;
  const opening = manager.open(input('b'));
  pending.resolve(first);
  const b = await opening;
  await new Promise(done => setImmediate(done));
  assert.equal(first.count, 1);
  assert.equal(second.count, 0);
  assert.equal(manager.status().id, b.id);
  await manager.shutdown();
  assert.equal(second.count, 1);
  await assert.rejects(manager.open(input('c')), /关闭/);
});
test('准备失败可恢复，退出后迟到的资源也会释放', async () => {
  const pending = deferred();
  const late = resource();
  let calls = 0;
  const manager = createLiveSessionManager({
    openSession: async () => {
      if (++calls === 1) throw Error('登录失败');
      return pending.promise;
    }
  });
  await assert.rejects(manager.open(input('bad')), /登录失败/);
  assert.equal(manager.status().state, 'failed');
  const next = manager.open(input('next'));
  const rejected = assert.rejects(next, /取消/);
  await new Promise(done => setImmediate(done));
  await manager.shutdown();
  await rejected;
  pending.resolve(late);
  await new Promise(done => setImmediate(done));
  assert.equal(late.count, 1);
});
test('取消先到达时不会迟开窗口；连续替换等待更早资源释放完成', async () => {
  const closing = deferred();
  const first = resource();
  first.close = async () => closing.promise;
  let calls = 0;
  const manager = createLiveSessionManager({
    openSession: async () => {
      calls++;
      return calls === 1 ? first : resource();
    }
  });
  await manager.close('cancelled-before-open');
  await assert.rejects(manager.open(input('cancelled-before-open')), /取消/);
  await manager.open(input('a'));
  const b = manager.open(input('b'));
  const rejected = assert.rejects(b, /取消/);
  const c = manager.open(input('c'));
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 1);
  closing.resolve();
  await rejected;
  await c;
  assert.equal(calls, 2);
  await manager.shutdown();
});

test('取消的旧启动未回收前不启动第二份资源', async () => {
  const gate = deferred();
  let active = 0,
    maximum = 0,
    calls = 0;
  const manager = createLiveSessionManager({
    openSession: async () => {
      calls++;
      active++;
      maximum = Math.max(maximum, active);
      if (calls === 1) await gate.promise;
      return {
        page: new EventEmitter(),
        close: async () => {
          active--;
        }
      };
    }
  });
  const first = manager.open(input('pending-owner'));
  const rejected = assert.rejects(first, /取消/);
  await new Promise(done => setImmediate(done));
  await manager.close();
  await rejected;
  const next = manager.open(input('next-owner'));
  await new Promise(done => setImmediate(done));
  try {
    assert.equal(calls, 1);
    assert.equal(maximum, 1);
  } finally {
    gate.resolve();
    await next;
    await manager.shutdown();
  }
});
