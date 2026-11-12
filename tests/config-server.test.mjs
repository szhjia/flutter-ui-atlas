import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from 'node:http';
import {serveConfig} from '../packages/cli/config-server.mjs';
import {createAuthenticationRunner} from '../packages/cli/config-auth.mjs';
import {configFixture, configure, draft} from './helpers/config-fixtures.mjs';

async function fixture(t) {
  const value = await configFixture(); const staticRoot = join(value.root, 'dist'); await mkdir(staticRoot);
  await writeFile(join(staticRoot, 'config.html'), '<h1>配置页</h1>');
  const authentication = createAuthenticationRunner({directory: value.directory, launchBrowser: () => { throw Error('不可达：敏感输入不可透传'); }});
  const service = await serveConfig({store: value.store, authentication, staticRoot});
  t.after(async () => { await service.close(); await value.cleanup(); });
  const api = (path, body) => fetch(service.origin + '/api/' + path, {method: body ? 'POST' : 'GET',
    headers: {'X-Atlas-Token': service.token, Origin: service.origin, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  return {...value, service, api};
}
test('本机 API 需要令牌和正确 Origin/Host，静态页无敏感注入', async t => {
  const {service, api} = await fixture(t);
  assert.equal((await fetch(service.origin + '/api/config')).status, 401);
  assert.equal((await api('config')).status, 200);
  assert.equal((await fetch(service.origin + '/api/project', {method: 'POST', headers: {
    Origin: 'https://external.example.test', 'X-Atlas-Token': service.token, 'Content-Type': 'application/json'}, body: '{}'})).status, 403);
  const host = await new Promise((done, reject) => {
    request(service.origin, {headers: {Host: 'external.example.test'}}, response => { response.resume(); done(response.statusCode); }).on('error', reject).end();
  });
  assert.equal(host, 421);
  assert(!(await (await fetch(service.origin)).text()).includes(service.token));
  assert.equal((await fetch(service.origin + '/.atlas/local/credentials.json')).status, 404);
});
test('请求体超限、无效 JSON、非法类型和未知接口均拒绝', async t => {
  const {api, service} = await fixture(t);
  assert.equal((await api('role', {data: 'x'.repeat(65_536)})).status, 413);
  assert.equal((await api('role', {enabled: true})).status, 400);
  assert.equal((await api('unknown', {})).status, 404);
  const response = await fetch(service.origin + '/api/role', {method: 'POST', headers: {
    Origin: service.origin, 'X-Atlas-Token': service.token, 'Content-Type': 'application/json'}, body: '{bad'});
  assert.equal(response.status, 400);
});
test('真实 API 保存和测试失败不回传密码，角色删除清除记录', async t => {
  const {api, store} = await fixture(t); await configure(store);
  const result = await (await api('test-login', draft())).json();
  assert.equal(result.status, 'failed'); assert(!result.message.includes('敏感输入'));
  const saved = await (await api('role', {...draft(), checkId: result.checkId})).json();
  assert.equal(saved.testStatus, 'failed');
  const response = await (await api('config')).text(); assert(!response.includes('example-password'));
  assert.equal((await api('enabled', {id: saved.id, enabled: false})).status, 200);
  assert.equal((await api('delete-role', {id: saved.id, revision: saved.revision})).status, 200);
  assert.deepEqual((await store.load()).roles, []);
});
test('认证超时关闭上下文；迟到的浏览器启动也会释放', async t => {
  const {root, directory, store} = await configFixture(); t.after(() => import('node:fs/promises').then(fs => fs.rm(root, {recursive: true, force: true})));
  await writeFile(join(directory, 'auth.mjs'), 'export default {version:"1", async login(){await new Promise(()=>{})}, async verify(){return {authenticated:true}}}');
  await store.saveProject({...((await store.load()).project), authentication: {type: 'module', module: './auth.mjs'}});
  let closed = 0;
  const browser = {async close() { closed++; }, async newContext() { return {async newPage() { return {setDefaultTimeout() {}}; }}; }};
  const runner = createAuthenticationRunner({directory, timeoutMs: 100, launchBrowser: async () => browser});
  assert.equal((await runner.test(await store.prepareLogin(draft()))).status, 'failed');
  assert.equal(closed, 1);
  const delayed = createAuthenticationRunner({directory, timeoutMs: 20, launchBrowser: async () => {
    await new Promise(done => setTimeout(done, 60)); return browser;
  }});
  await delayed.test(await store.prepareLogin(draft()));
  await new Promise(done => setTimeout(done, 100));
  assert.equal(closed, 2);
  await runner.close(); await delayed.close();
});
