import {randomUUID} from 'node:crypto';

// 每次打开独占一个资源。取消立即结束调用；不遵守 signal 的迟到资源仍由本管理器回收。
export function createLiveSessionManager({openSession}) {
  let current = null;
  let stopped = false;
  let state = {state: 'idle'};
  const used = new Set();
  const cancelledRequests = new Set();
  const cleanups = new Set();
  const preparations = new Set();
  const cancelled = () => Object.assign(Error('实时会话已取消。'), {name: 'AbortError'});
  function dispose(session) {
    session.controller.abort();
    session.reject(cancelled());
    if (session.resource && !session.disposal) {
      session.resource.page?.off?.('close', session.onClose);
      session.disposal = Promise.resolve().then(() => session.resource.close());
      // 手动关窗产生的清理也必须有 rejection 接收者。
      cleanups.add(session.disposal);
      session.disposal.then(
        () => cleanups.delete(session.disposal),
        () => cleanups.delete(session.disposal)
      );
    }
    return session.disposal ?? Promise.resolve();
  }
  async function close(id) {
    const session = current;
    if (id !== undefined) cancelledRequests.add(id);
    if (!session || (id !== undefined && id !== session.id && id !== session.requestId)) return;
    current = null;
    state = {state: 'idle'};
    await dispose(session);
  }
  return {
    status: () => ({...state}),
    close,
    async open({screenId, captureId, requestId = randomUUID()}) {
      if (stopped) throw Error('实时会话管理器已关闭。');
      if (
        ![screenId, captureId, requestId].every(
          value => typeof value === 'string' && value.length > 0 && value.length <= 256
        )
      )
        throw Error('实时会话标识无效。');
      if (cancelledRequests.has(requestId)) throw cancelled();
      if (used.has(requestId)) throw Error('实时会话请求标识已使用。');
      used.add(requestId);
      const previous = current;
      const session = {id: randomUUID(), requestId, screenId, captureId, controller: new AbortController()};
      const aborted = new Promise((_, reject) => {
        session.reject = reject;
      });
      aborted.catch(() => {});
      current = session;
      const handle = {id: session.id, requestId, screenId, captureId};
      state = {...handle, state: 'opening'};
      session.onClose = () => {
        void close(session.id).catch(() => {});
      };
      const predecessors = [...preparations];
      const preparation = Promise.resolve().then(async () => {
        if (previous) void dispose(previous);
        await Promise.all(predecessors.map(pending => pending.catch(() => {})));
        await Promise.all([...cleanups]);
        if (session.controller.signal.aborted) throw cancelled();
        const resource = await openSession({screenId, captureId, signal: session.controller.signal});
        session.resource = resource;
        if (current !== session || session.controller.signal.aborted || stopped) {
          await dispose(session);
          throw cancelled();
        }
        if (!resource || typeof resource.close !== 'function' || !resource.page) throw Error('实时会话资源无效。');
        resource.page.once?.('close', session.onClose);
        if (resource.page.isClosed?.()) {
          await close(session.id);
          throw cancelled();
        }
        state = {...handle, state: 'ready'};
        return {...state};
      });
      preparations.add(preparation);
      preparation.then(
        () => preparations.delete(preparation),
        () => preparations.delete(preparation)
      );
      try {
        return await Promise.race([preparation, aborted]);
      } catch (error) {
        if (current === session) {
          current = null;
          state = {...handle, state: 'failed', error: error.message};
        }
        await dispose(session);
        throw error;
      }
    },
    async shutdown() {
      stopped = true;
      await close();
      await Promise.all([...cleanups]);
    }
  };
}
