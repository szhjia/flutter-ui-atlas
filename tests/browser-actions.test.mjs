import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';

test('共享执行器顺序操作、all内容与路由判据、失败正文和同源限制', async t => {
  const server = createServer((_, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<label>账号<input></label><button onclick="document.querySelector('h1').textContent=document.querySelector('input').value;location.hash='/done'">进入</button><h1>准备</h1>`
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  const module = await import('../packages/cli/browser-actions.mjs').catch(() => ({}));
  assert.equal(typeof module.executeSteps, 'function');
  const browser = await chromium.launch({channel: 'chrome'});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  await module.executeSteps(
    page,
    [
      {action: 'goto', url: '/'},
      {action: 'fill', target: {kind: 'label', name: '账号'}, value: 'user1'},
      {
        click: {
          any: [
            {role: 'button', name: '进入'},
            {role: 'link', name: '进入'}
          ]
        }
      }
    ],
    {baseUrl, timeoutMs: 1000}
  );
  const ready = {all: [{route: '/done'}, {role: 'heading', name: 'user1'}]};
  await module.waitReady(page, ready, {baseUrl, timeoutMs: 500});
  assert.equal(await module.matchesReady(page, ready, {baseUrl}), true);
  const alternatives = {
    any: [
      {all: [{route: '/done'}, {text: 'Missing body content'}]},
      {all: [{route: '/done'}, {role: 'heading', name: 'user1'}]}
    ]
  };
  module.validateCondition(alternatives);
  assert.equal(await module.matchesReady(page, alternatives, {baseUrl}), true);
  assert.equal(
    await module.matchesReady(
      page,
      {any: [alternatives.any[0], {all: [{text: 'Wrong total'}, {role: 'heading', name: 'user1'}]}]},
      {baseUrl}
    ),
    false
  );
  assert.equal(await module.matchesReady(page, {not: {role: 'heading', name: 'user1'}}, {baseUrl}), false);
  assert.equal(await module.matchesReady(page, {not: {text: '不存在正文'}}, {baseUrl}), true);
  await assert.rejects(
    module.waitReady(page, {all: [{route: '/done'}, {text: '不存在正文'}]}, {baseUrl, timeoutMs: 100}),
    /就绪/
  );
  await assert.rejects(module.executeSteps(page, [{goto: 'http://example.com/'}], {baseUrl}), /同源/);
});
