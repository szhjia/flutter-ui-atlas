import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {assertApplicationReachable} from '../packages/cli/application-reachability.mjs';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('follows relative same-origin redirects for every supported HTTP status', async t => {
  const statuses = [301, 302, 303, 307, 308];
  const requests = [];
  const base = await serve(t, (req, res) => {
    requests.push(req.url);
    const index = Number(req.url.slice(1));
    if (index < statuses.length) res.writeHead(statuses[index], {Location: String(index + 1)}).end();
    else res.end('Ready');
  });
  await assertApplicationReachable(base + '/0');
  assert.deepEqual(requests, ['/0', '/1', '/2', '/3', '/4', '/5']);
});

test('rejects a cross-origin redirect before contacting its target', async t => {
  let hits = 0;
  const target = await serve(t, (_req, res) => {
    hits++;
    res.end('Ready');
  });
  const base = await serve(t, (_req, res) => res.writeHead(302, {Location: target}).end());
  await assert.rejects(assertApplicationReachable(base), /configured origin/);
  assert.equal(hits, 0);
});

test('bounds redirect loops and rejects unusable responses', async t => {
  let hits = 0;
  const base = await serve(t, (req, res) => {
    hits++;
    if (req.url === '/loop') res.writeHead(302, {Location: '/loop'}).end();
    else if (req.url === '/missing') res.writeHead(302).end();
    else res.writeHead(503).end();
  });
  await assert.rejects(assertApplicationReachable(base + '/loop'), /usable response/);
  assert.equal(hits, 11);
  await assert.rejects(assertApplicationReachable(base + '/missing'), /usable response/);
  await assert.rejects(assertApplicationReachable(base + '/error'), /usable response/);
});

test('times out a stalled response', async t => {
  const base = await serve(t, () => {});
  await assert.rejects(assertApplicationReachable(base), {name: 'TimeoutError'});
});
