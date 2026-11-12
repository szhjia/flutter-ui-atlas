import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {serveViewer} from '../packages/cli/view-server.mjs';
function http(url, {path = '/', method = 'GET', headers = {}, body} = {}) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, url), {method, headers}, res => {
      let text = '';
      res.on('data', chunk => (text += chunk));
      res.on('end', () => resolve({status: res.statusCode, text}));
    });
    req.on('error', reject);
    req.end(body);
  });
}
test('实时 API 验证本机 Host、Origin、token 和严格字段，关闭服务只关闭自己的 manager', async () => {
  let opened = [];
  let stopped = 0;
  let closed = [];
  const liveSessions = {
    open: async input => {
      opened.push(input);
      return {id: 'session', ...input, state: 'ready'};
    },
    close: async id => closed.push(id),
    status: () => ({state: 'idle'}),
    shutdown: async () => {
      stopped++;
    }
  };
  const service = await serveViewer({
    config: {artifactPaths: []},
    port: 0,
    output: '.',
    publicPath: '/captures',
    liveSessions
  });
  try {
    const root = await http(service.url);
    const config = JSON.parse(root.text.match(/id="atlas-config">([^<]+)</)[1]);
    assert.ok(config.managedLive.token);
    const path = config.managedLive.endpoint + '/open';
    const headers = {
      'content-type': 'application/json',
      origin: new URL(service.url).origin,
      'x-atlas-token': config.managedLive.token
    };
    const body = JSON.stringify({screenId: 'a', captureId: 'b', requestId: 'r'});
    assert.equal(
      (await http(service.url, {path, method: 'POST', headers: {...headers, host: 'evil.test'}, body})).status,
      421
    );
    assert.equal(
      (await http(service.url, {path, method: 'POST', headers: {...headers, origin: 'https://evil.test'}, body}))
        .status,
      403
    );
    assert.equal(
      (await http(service.url, {path, method: 'POST', headers: {...headers, 'x-atlas-token': 'wrong'}, body})).status,
      401
    );
    assert.equal(
      (
        await http(service.url, {
          path,
          method: 'POST',
          headers,
          body: JSON.stringify({screenId: 'a', captureId: 'b', url: 'https://evil.test', credentials: {}})
        })
      ).status,
      400
    );
    assert.equal(opened.length, 0);
    assert.equal((await http(service.url, {path, method: 'POST', headers, body})).status, 200);
    assert.deepEqual(opened, [{screenId: 'a', captureId: 'b', requestId: 'r'}]);
    assert.equal(
      (
        await http(service.url, {
          path: config.managedLive.endpoint + '/close',
          method: 'POST',
          headers,
          body: '{"id":"r"}'
        })
      ).status,
      200
    );
    assert.deepEqual(closed, ['r']);
    assert.equal((await http(service.url, {path: config.managedLive.endpoint + '/status', headers})).status, 200);
  } finally {
    await service.close();
  }
  assert.equal(stopped, 1);
});
test('没有 manager 时保持只读且不注入控制 token', async () => {
  const service = await serveViewer({config: {artifactPaths: []}, port: 0, output: '.', publicPath: '/captures'});
  try {
    assert.ok(!(await http(service.url)).text.includes('managedLive'));
    assert.equal((await http(service.url, {path: '/__atlas/live/open', method: 'POST'})).status, 405);
  } finally {
    await service.close();
  }
});
test('客户端中断等待时释放对应 pending 会话，不误关后续会话', async () => {
  const {createLiveSessionManager} = await import('../packages/cli/live-sessions.mjs');
  let begun;
  const started = new Promise(resolve => (begun = resolve));
  let signal;
  const manager = createLiveSessionManager({
    openSession: async input => {
      signal = input.signal;
      begun();
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(Error('cancelled')), {once: true})
      );
    }
  });
  const service = await serveViewer({
    config: {artifactPaths: []},
    port: 0,
    output: '.',
    publicPath: '/captures',
    liveSessions: manager
  });
  try {
    const html = await http(service.url);
    const {managedLive} = JSON.parse(html.text.match(/id="atlas-config">([^<]+)</)[1]);
    const req = request(
      new URL('/__atlas/live/open', service.url),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: new URL(service.url).origin,
          'x-atlas-token': managedLive.token
        }
      },
      () => {}
    );
    req.on('error', () => {});
    req.end(JSON.stringify({screenId: 'a', captureId: 'b', requestId: 'interrupted'}));
    await started;
    req.destroy();
    for (let i = 0; i < 30 && !signal.aborted; i++) await new Promise(done => setTimeout(done, 10));
    assert.equal(signal.aborted, true);
    assert.equal(manager.status().state, 'idle');
  } finally {
    await service.close();
  }
});
