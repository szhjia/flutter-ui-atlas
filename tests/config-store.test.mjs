import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmod, lstat, mkdir, readFile, stat, symlink, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createConfigStore} from '../packages/cli/config-store.mjs';
import {readConfigFile} from '../packages/cli/project.mjs';
import {parse} from 'yaml';
import {configFixture, configure, draft} from './helpers/config-fixtures.mjs';

async function fixture(t) { const value = await configFixture(); t.after(value.cleanup); return value; }
const credentialsFile = directory => join(directory, 'local/credentials.json');
const edit = (role, fields = {}) => draft({...role, password: '', ...fields});

test('从 Flutter 子目录打开空配置，不植入示例角色或凭据', async t => {
  const {store, directory} = await fixture(t);
  assert.deepEqual((await store.load()).roles, []);
  assert.equal((await store.load()).project.name, 'config_example');
  await assert.rejects(lstat(join(directory, 'atlas.yaml')), {code: 'ENOENT'});
});
test('首次直接保存角色也生成 CLI 可读取的完整默认应用配置', async t => {
  const {store, directory} = await fixture(t);
  const shown = (await store.load()).project;
  await store.saveRole(draft());
  const persisted = (await readConfigFile(join(directory, 'atlas.yaml'))).config;
  assert.equal(persisted.title, shown.name);
  assert.equal(persisted.baseUrl, shown.baseUrl);
  assert.equal(persisted.readyText, '');
});
test('仅改名称、启停和角色名称时保留嵌套未知字段与所有原注释', async t => {
  const {store, directory} = await fixture(t);
  const id = '12345678-1234-1234-1234-123456789abc';
  const contents = `# 项目注释
title: 原名称 # 应用名称注释
baseUrl: http://127.0.0.1:8080/
authentication: # 认证映射注释
  type: form # 登录类型注释
  loginUrl: /
  extensionField: 保留认证扩展 # 认证扩展注释
  username: # 账号定位注释
    kind: label
    name: 登录账号 # 标签注释
    customLocator: 保留定位扩展 # 定位扩展注释
  password: {kind: label, name: 登录密码}
  submit: {kind: role, role: button, name: 登录}
  success: {kind: text, name: 登录成功}
roles: # 角色列表注释
  - id: ${id} # 稳定身份注释
    tag: reader
    name: 只读用户 # 角色名称注释
    enabled: true # 启停注释
    extensionField: 保留角色扩展 # 角色扩展注释
`;
  await writeFile(join(directory, 'atlas.yaml'), contents);
  const project = (await store.load()).project;
  await store.saveProject({...project, name: '已改名称'});
  await store.setEnabled(id, false);
  const role = (await store.load()).roles[0];
  await store.saveRole(edit(role, {name: '新角色名称', username: 'reader@example.test'}));
  const updated = await readFile(join(directory, 'atlas.yaml'), 'utf8');
  for (const comment of contents.match(/#[^\n]+/g)) assert(updated.includes(comment), `丢失注释：${comment}`);
  const value = parse(updated);
  assert.equal(value.authentication.extensionField, '保留认证扩展');
  assert.equal(value.authentication.username.customLocator, '保留定位扩展');
  assert.equal(value.roles[0].extensionField, '保留角色扩展');
  assert.equal(value.roles[0].enabled, false);
});
test('保存保留未知 YAML、注释及既有路径，凭据只写私有文件', async t => {
  const {store, directory, root} = await fixture(t);
  await writeFile(join(directory, 'atlas.yaml'), '# 保留注释\ncustom: {answer: 42}\noutput: screenshots\nsourceFiles: [../lib/main.dart]\n');
  await configure(store);
  const role = await store.saveRole(draft());
  const yaml = await readFile(join(directory, 'atlas.yaml'), 'utf8');
  assert.match(yaml, /# 保留注释/); assert.match(yaml, /answer: 42/); assert.match(yaml, /output: screenshots/);
  assert.match(yaml, /\.\.\/lib\/main.dart/);
  assert(!yaml.includes('reader@example.test')); assert(!yaml.includes('example-password'));
  assert(!JSON.stringify(await store.load()).includes('example-password'));
  assert.equal((await stat(join(directory, 'local'))).mode & 0o777, 0o700);
  assert.equal((await stat(credentialsFile(directory))).mode & 0o777, 0o600);
  assert.match(await readFile(join(directory, '.gitignore'), 'utf8'), /^\/local\/$/m);
  assert.equal((await createConfigStore({cwd: root})).load instanceof Function, true);
  const again = await createConfigStore({cwd: root});
  assert.equal((await again.load()).roles[0].id, role.id);
});
test('独立启停与旧表单并发保存均保留，忽略注入的 enabled', async t => {
  const {store} = await fixture(t); const role = await store.saveRole(draft());
  await Promise.all([store.setEnabled(role.id, false), store.saveRole(edit(role, {name: '新名称', enabled: true}))]);
  assert.deepEqual((await store.load()).roles.map(({name, enabled}) => ({name, enabled})), [{name: '新名称', enabled: false}]);
});
test('相同角色的旧编辑版本返回冲突，重复 Tag 拒绝保存', async t => {
  const {store} = await fixture(t); const role = await store.saveRole(draft());
  await store.saveRole(edit(role, {name: '第一次修改'}));
  await assert.rejects(store.saveRole(edit(role, {name: '过期修改'})), error => error.status === 409);
  await assert.rejects(store.saveRole(draft()), /Tag 已被使用/);
});
test('留空保持密码，清除后待配置，删除同时移除本机凭据', async t => {
  const {store, directory} = await fixture(t);
  const first = await store.saveRole(draft());
  const same = await store.saveRole(edit(first, {name: '保留密码'}));
  assert.equal(same.passwordSet, true);
  const cleared = await store.saveRole(edit(same, {clearPassword: true}));
  assert.equal(cleared.passwordSet, false); assert.equal(cleared.testStatus, 'unconfigured');
  await store.deleteRole(cleared.id, cleared.revision);
  assert.deepEqual((await store.load()).roles, []);
  assert.deepEqual(JSON.parse(await readFile(credentialsFile(directory), 'utf8')).roles, {});
});
for (const status of ['passed', 'failed']) test(`匹配凭据保存保留 ${status} 结果并支持服务重启`, async t => {
  const {store, root} = await fixture(t); await configure(store);
  const input = draft();
  const result = store.recordLogin(await store.prepareLogin(input), {status, message: '测试结果'});
  const saved = await store.saveRole({...input, checkId: result.checkId});
  assert.equal(saved.testStatus, status);
  assert.equal((await store.saveRole(edit(saved))).testStatus, status);
  const restarted = await createConfigStore({cwd: root});
  assert.equal((await restarted.load()).roles[0].testStatus, status);
});
test('凭据、Tag、地址或登录配置改变使旧结果失效，伪造 checkId 无效', async t => {
  const {store} = await fixture(t); await configure(store);
  const input = draft();
  const result = store.recordLogin(await store.prepareLogin(input), {status: 'passed', message: '通过'});
  let role = await store.saveRole({...input, checkId: result.checkId});
  role = await store.saveRole(edit(role, {password: 'another', checkId: result.checkId}));
  assert.equal(role.testStatus, 'untested');
  role = await store.saveRole(edit(role, {tag: 'other', checkId: 'forged'}));
  assert.equal(role.testStatus, 'untested');
  const current = (await store.load()).project;
  await store.saveProject({...current, baseUrl: 'http://127.0.0.1:8090/', authentication: {...current.authentication, loginUrl: 'http://127.0.0.1:8090/'}});
  assert.equal((await store.load()).roles[0].testStatus, 'untested');
  await assert.rejects(store.saveProject(current), error => error.status === 409);
});
test('模块源码变化使原登录结果失效', async t => {
  const {store, directory} = await fixture(t);
  const module = join(directory, 'auth.mjs'); await writeFile(module, 'export default {version: "1"}');
  await store.saveProject({...((await store.load()).project), authentication: {type: 'module', module: './auth.mjs'}});
  const input = draft(); const result = store.recordLogin(await store.prepareLogin(input), {status: 'passed', message: '通过'});
  await store.saveRole({...input, checkId: result.checkId});
  await writeFile(module, 'export default {version: "2"}');
  assert.equal((await store.load()).roles[0].testStatus, 'untested');
});
for (const expired of [false, true]) test(`${expired ? '过期' : '伪造'}的新测试凭证不能回退为旧通过结果`, async t => {
  const {store} = await fixture(t); await configure(store);
  const input = draft();
  const old = store.recordLogin(await store.prepareLogin(input), {status: 'passed', message: '旧结果'});
  const saved = await store.saveRole({...input, checkId: old.checkId});
  const failed = store.recordLogin(await store.prepareLogin(edit(saved)), {status: 'failed', message: '新结果'});
  if (expired) {
    t.mock.timers.enable({apis: ['Date'], now: Date.now()});
    t.mock.timers.tick(300_001);
  }
  const next = await store.saveRole(edit(saved, {checkId: expired ? failed.checkId : 'forged'}));
  assert.equal(next.testStatus, 'untested');
});
test('未提交事务在重启时恢复完整旧版本，已提交事务不回滚', async t => {
  const {store, directory, root} = await fixture(t); await store.saveRole(draft());
  const oldYaml = await readFile(join(directory, 'atlas.yaml'), 'utf8');
  const oldCredentials = await readFile(credentialsFile(directory), 'utf8');
  const journal = join(directory, 'local/transaction.json');
  await writeFile(journal, JSON.stringify({version: 1, state: 'prepared', yaml: oldYaml, credentials: oldCredentials}), {mode: 0o600});
  await writeFile(join(directory, 'atlas.yaml'), 'title: 未提交的新版本\n');
  await writeFile(credentialsFile(directory), '{"version":1,"roles":{}}');
  const recovered = await createConfigStore({cwd: root});
  assert.equal((await recovered.load()).roles.length, 1);
  assert.equal(await readFile(join(directory, 'atlas.yaml'), 'utf8'), oldYaml);
  await writeFile(journal, JSON.stringify({version: 1, state: 'committed', yaml: null, credentials: null}), {mode: 0o600});
  await recovered.load();
  assert.equal((await recovered.load()).roles.length, 1);
  await assert.rejects(lstat(journal), {code: 'ENOENT'});
});
test('YAML 发布失败不留下新凭据，恢复后仍可读取旧角色', async t => {
  const {store, directory, root} = await fixture(t); const role = await store.saveRole(draft());
  const before = await readFile(credentialsFile(directory), 'utf8');
  await chmod(directory, 0o500);
  try { await assert.rejects(store.saveRole(edit(role, {password: 'not-published'}))); }
  finally { await chmod(directory, 0o700); }
  const restarted = await createConfigStore({cwd: root});
  assert.equal(await readFile(credentialsFile(directory), 'utf8'), before);
  assert.equal((await restarted.load()).roles[0].revision, role.revision);
});
test('损坏文件拒绝覆盖；旧 JSON 配置不迁移、不改写', async t => {
  const {store, directory, root} = await fixture(t);
  await writeFile(join(directory, 'atlas.yaml'), 'a: 1\na: 2\n');
  await assert.rejects(store.load(), /YAML/);
  await rm(join(directory, 'atlas.yaml'));
  const legacy = '{"output":"../original"}'; await writeFile(join(root, 'atlas.config.json'), legacy);
  await assert.rejects(createConfigStore({cwd: root}), /旧 JSON\/MJS/);
  assert.equal(await readFile(join(root, 'atlas.config.json'), 'utf8'), legacy);
});
test('既有 adapterConfig 引用保持原样，不改写可信 MJS', async t => {
  const {store, directory} = await fixture(t);
  await writeFile(join(directory, 'atlas.yaml'), 'adapterConfig: ../adapter.mjs\noutput: previous\n');
  await store.saveRole(draft());
  assert.match(await readFile(join(directory, 'atlas.yaml'), 'utf8'), /adapterConfig: ..\/adapter.mjs/);
});
test('拒绝符号链接凭据和已被 Git 跟踪的私有文件', async t => {
  const {store, root, directory} = await fixture(t);
  const outside = join(root, 'outside'); await writeFile(outside, '保留');
  await symlink(outside, credentialsFile(directory));
  await assert.rejects(store.saveRole(draft()), /符号链接/);
  assert.equal(await readFile(outside, 'utf8'), '保留');
  await rm(credentialsFile(directory));
  await writeFile(credentialsFile(directory), '{"version":1,"roles":{}}');
  execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, 'add', '-f', '.atlas/local/credentials.json']);
  await assert.rejects(store.saveRole(draft()), /Git 跟踪/);
});
