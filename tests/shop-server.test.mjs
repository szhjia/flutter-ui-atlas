import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveShop} from './helpers/shop-server.mjs';

test('Demo 静态服务正确提供构建资源，拒绝越界与写请求', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shop-static-'));
  const outside = await mkdtemp(join(tmpdir(), 'shop-outside-'));
  let server;
  try {
    await writeFile(join(directory, 'index.html'), '<h1>商城 Demo</h1>');
    await writeFile(join(directory, 'engine.wasm'), new Uint8Array([0, 97, 115, 109]));
    await writeFile(join(outside, 'private.txt'), '范围外内容');
    await symlink(join(outside, 'private.txt'), join(directory, 'outside.txt'));
    server = await serveShop({port: 0, directory});
    const base = `http://127.0.0.1:${server.address().port}`;
    const root = await fetch(base);
    assert.equal(root.status, 200);
    assert.equal(await root.text(), '<h1>商城 Demo</h1>');
    assert.equal(root.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + '/engine.wasm')).headers.get('content-type'), 'application/wasm');
    assert.equal((await fetch(base + '/missing')).status, 404);
    assert.equal((await fetch(base + '/outside.txt')).status, 403);
    assert.equal((await fetch(base, {method: 'POST'})).status, 405);
    assert.equal(await (await fetch(base, {method: 'HEAD'})).text(), '');
    await assert.rejects(serveShop({port: server.address().port, directory}), {code: 'EADDRINUSE'});
  } finally {
    if (server) await new Promise(done => server.close(done));
    await rm(directory, {recursive: true, force: true});
    await rm(outside, {recursive: true, force: true});
  }
});
