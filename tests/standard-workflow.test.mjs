import {readWorkspaceManifest} from '../packages/cli/workspace-build.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fsPromises, {readFile, readdir, stat, writeFile, realpath} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {parse, stringify} from 'yaml';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {standardFixture} from './helpers/standard-application.mjs';
import {draft} from './helpers/config-fixtures.mjs';
import {resolveProjectConfig, selectProfiles} from '../packages/cli/project.mjs';
import {buildStandard, standardLiveSessions} from '../packages/cli/managed-workflow.mjs';
import {launchManagedBrowser} from '../packages/cli/managed-browser.mjs';
const cli = fileURLToPath(new URL('../packages/cli/index.mjs', import.meta.url));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function manifestAt(output, profile = null) {
  const bundle = await readWorkspaceManifest(output, profile);
  const maps = bundle.workspaces.map(w => w.map);
  return {
    ...bundle,
    screens: [...new Map(maps.flatMap(m => m.screens.map(s => [s.id, {...s, captureId: m.captureId}]))).values()],
    edges: [...new Map(maps.flatMap(m => m.edges.map(e => [e.id, e]))).values()]
  };
}
async function fixture(t, options) {
  const value = await standardFixture(options);
  t.after(async () => {
    await value.cleanupLive?.();
    await value.cleanup();
  });
  return value;
}
async function inputFor(f) {
  const input = await resolveProjectConfig({cwd: f.root});
  return {...input, output: resolve(input.directory, input.config.output ?? 'generated'), publicPath: '/generated'};
}
function cliBuild(root, ...args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, 'build', ...args], {
      cwd: root,
      env: {...process.env, ATLAS_BROWSER_CHANNEL: 'chrome'},
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', value => (stdout += value));
    child.stderr.on('data', value => (stderr += value));
    child.once('error', reject);
    child.once('close', code => done({code, stdout, stderr}));
  });
}
function launcher() {
  const pids = [];
  const browsers = new Map();
  return {
    pids,
    browsers,
    launch: async () => {
      const browser = await launchManagedBrowser({channel: 'chrome'});
      pids.push(browser.atlasPid);
      browsers.set(browser.atlasPid, browser);
      return browser;
    }
  };
}
async function stopped(pid) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
    await new Promise(done => setTimeout(done, 20));
  }
  return false;
}
async function build(f, launch) {
  const input = await inputFor(f);
  return {input, code: await buildStandard(input, selectProfiles(input.config), launch, {force: true})};
}
async function artifacts(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.name === 'local') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await artifacts(path)));
    else if (/\.(json|yaml|yml|html|js|mjs)$/.test(entry.name)) result.push([path, await readFile(path, 'utf8')]);
  }
  return result;
}

async function sessionRecord(f, captureId, screenId) {
  const directory = join(f.directory, 'local/sessions');
  for (const file of await readdir(directory)) {
    let record;
    try {
      record = await json(join(directory, file));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (record.captureId === captureId && record.screenId === screenId) return {...record, file};
  }
  return undefined;
}

test('标准 CLI 使用真实 Chrome 构建不同路由，并隔离凭据与私有版本', async t => {
  const f = await fixture(t);
  const result = await cliBuild(f.root);
  assert.equal(result.code, 0, result.stderr);
  const input = await inputFor(f);
  const manifest = await manifestAt(input.output);
  assert.equal(manifest.screens.length, 2);
  assert.ok(manifest.screens.every(screen => screen.status === 'captured'));
  assert.deepEqual(new Set(manifest.screens.map(screen => screen.actualRoute)), new Set(['/list', '/detail']));
  assert.equal(manifest.edges[0].status, 'observed');
  const snapshot = await f.store.readBuildSnapshot();
  assert.equal((await stat(join(f.directory, 'build-state', manifest.generationId + '.json'))).mode & 0o777, 0o600);
  for (const [path, body] of await artifacts(f.directory)) {
    assert.ok(!body.includes('standard-private-password'), `密码泄露 ${path}`);
    assert.ok(!body.includes(snapshot.version), `私有版本泄露 ${path}`);
    assert.ok(!body.includes('credentials'), `凭据对象泄露 ${path}`);
  }
  assert.ok(!result.stdout.includes('standard-private-password'));
  assert.ok(!result.stderr.includes('standard-private-password'));
});

test('中文和空格hash路由可采集、验证真实连线并打开实时会话', async t => {
  const f = await fixture(t);
  const config = parse(await readFile(f.file, 'utf8'));
  for (const screen of config.screens) screen.route = screen.id === 'detail' ? '/商品 详情' : '/商品 列表';
  await writeFile(f.file, stringify(config));
  const browsers = launcher();
  const result = await build(f, browsers.launch);
  assert.equal(result.code, 0);
  const manifest = await manifestAt(result.input.output);
  const expectedRoute = '/%E5%95%86%E5%93%81%20%E5%88%97%E8%A1%A8';
  assert.equal(manifest.screens.length, 2);
  for (const screen of manifest.screens) {
    assert.equal(screen.status, 'captured');
    const route = screen.id.endsWith(':detail') ? '/%E5%95%86%E5%93%81%20%E8%AF%A6%E6%83%85' : expectedRoute;
    assert.equal(screen.route, route);
    assert.equal(screen.actualRoute, route);
  }
  assert.equal(manifest.edges[0].status, 'observed');
  const manager = await standardLiveSessions(result.input, selectProfiles(result.input.config)[0], browsers.launch);
  f.cleanupLive = () => manager.shutdown();
  const detail = manifest.screens.find(screen => screen.id.endsWith(':detail'));
  await manager.open({screenId: detail.id, captureId: manifest.captureId, requestId: 'encoded-route'});
  const record = await sessionRecord(f, manifest.captureId, detail.id);
  const page = browsers.browsers.get(record.pid).contexts()[0].pages()[0];
  assert.equal(new URL(page.url()).hash, '#/%E5%95%86%E5%93%81%20%E8%AF%A6%E6%83%85');
  assert.equal(await page.getByRole('heading', {name: 'reader 正文详情', exact: true}).isVisible(), true);
  await page.getByRole('button', {name: '计数 0', exact: true}).click();
  assert.equal(await page.getByRole('button', {name: '计数 1', exact: true}).isVisible(), true);
  await manager.close();
  assert.equal(await stopped(record.pid), true);
});

test('匿名和具名账户共享两端页面时构建保留四条独立声明连线', async t => {
  const f = await fixture(t);
  const config = parse(await readFile(f.file, 'utf8'));
  for (const screen of config.screens) {
    screen.roles = ['@anonymous', 'reader'];
    screen.prepare = [];
    screen.ready = {
      any: [
        {role: 'button', name: '登录'},
        {role: 'heading', name: `{{role.tag}} 正文${screen.id === 'detail' ? '详情' : '列表'}`}
      ]
    };
  }
  config.edges = [{id: 'related', source: 'list', target: 'detail', action: '关联页面'}];
  config.requireObservedEdges = false;
  await writeFile(f.file, stringify(config));
  const browsers = launcher();
  const result = await build(f, browsers.launch);
  assert.equal(result.code, 0);
  const manifest = await manifestAt(result.input.output);
  const reader = (await f.store.load()).roles.find(role => role.tag === 'reader');
  assert.equal(manifest.screens.length, 4);
  assert.ok(manifest.screens.every(screen => screen.status === 'captured'));
  assert.equal(manifest.edges.length, 4);
  assert.equal(new Set(manifest.edges.map(edge => edge.id)).size, 4);
  assert.ok(manifest.edges.every(edge => edge.status === 'declared'));
  assert.deepEqual(
    new Set(manifest.edges.map(edge => [edge.source, edge.target].join(' -> '))),
    new Set([
      '@anonymous:list -> @anonymous:detail',
      `@anonymous:list -> ${reader.id}:detail`,
      `${reader.id}:list -> @anonymous:detail`,
      `${reader.id}:list -> ${reader.id}:detail`
    ])
  );
});

test('CLI 密码错误给出失败退出码及报告，停用账户不产生其页面', async t => {
  const f = await fixture(t, {roles: ['reader', 'admin']});
  const reader = (await f.store.load()).roles.find(role => role.tag === 'reader');
  await f.store.saveRole(draft({...reader, password: 'wrong-private-password'}));
  const failed = await cliBuild(f.root);
  assert.equal(failed.code, 1);
  const input = await inputFor(f);
  const attempt = await json(join(input.output, 'latest-attempt.json'));
  assert.equal(attempt.status, 'failed');
  assert.match(attempt.error, /登录/);
  assert.ok(!JSON.stringify(attempt).includes('wrong-private-password'));
  await f.store.setEnabled(reader.id, false);
  const passed = await cliBuild(f.root);
  assert.equal(passed.code, 0, passed.stderr);
  const manifest = await manifestAt(input.output);
  assert.equal(manifest.screens.length, 2);
  assert.ok(manifest.screens.every(screen => !screen.id.startsWith(reader.id + ':')));
});
test('正文缺失与应用不可达保留上一好图，失败批次关闭独占Chrome', async t => {
  const f = await fixture(t);
  const browsers = launcher();
  let result = await build(f, browsers.launch);
  assert.equal(result.code, 0);
  const before = await readFile(join(result.input.output, 'index.json'), 'utf8');
  f.app.controls.missing = true;
  result = await build(f, browsers.launch);
  assert.equal(result.code, 1);
  assert.match((await json(join(result.input.output, 'latest-attempt.json'))).error, /正文|就绪/);
  assert.equal(await readFile(join(result.input.output, 'index.json'), 'utf8'), before);
  await f.app.close();
  result = await build(f, browsers.launch);
  assert.equal(result.code, 1);
  assert.match((await json(join(result.input.output, 'latest-attempt.json'))).error, /unreachable/);
  assert.equal(await readFile(join(result.input.output, 'index.json'), 'utf8'), before);
  for (const pid of browsers.pids) assert.equal(await stopped(pid), true, `Chrome 未退出 ${pid}`);
});
test('采集途中配置变化拒绝发布混合版本，旧图和私有记录保持可追溯', async t => {
  const f = await fixture(t);
  const browsers = launcher();
  const before = await build(f, browsers.launch);
  assert.equal(before.code, 0);
  const previous = await readFile(join(before.input.output, 'index.json'), 'utf8');
  let changed = false;
  f.app.controls.onAuthenticated = async () => {
    if (changed) return;
    changed = true;
    const {project} = await f.store.load();
    await f.store.saveProject({...project, name: '采集期间变更'});
  };
  const result = await build(f, browsers.launch);
  assert.equal(changed, true);
  assert.equal(result.code, 1);
  assert.equal(await readFile(join(result.input.output, 'index.json'), 'utf8'), previous);
  const attempt = await json(join(result.input.output, 'latest-attempt.json'));
  assert.equal(attempt.status, 'failed');
  assert.match(attempt.error, /配置或凭据已变化/);
  assert.equal(attempt.stage, 'workspace');
  await assert.rejects(f.store.readBuildRecord(attempt.captureId), /没有可用/);
});
test('命名profile任一失败保留整个上一成功索引', async t => {
  const f = await fixture(t, {profiles: {small: {width: 360, height: 640}, large: {width: 900, height: 700}}});
  const browsers = launcher();
  const result = await build(f, browsers.launch);
  assert.equal(result.code, 0);
  const small = JSON.stringify(await manifestAt(result.input.output, 'small'));
  const large = await manifestAt(result.input.output, 'large');
  f.app.controls.failWidthBelow = 600;
  assert.equal((await build(f, browsers.launch)).code, 1);
  assert.equal(JSON.stringify(await manifestAt(result.input.output, 'small')), small);
  assert.equal((await json(join(result.input.output, 'latest-attempt.json'))).status, 'failed');
  assert.equal((await manifestAt(result.input.output, 'large')).captureId, large.captureId);
});
test('独立live会话真实操作保持账户、viewport和独占Chrome进程隔离并清理私有会话记录', async t => {
  const f = await fixture(t, {
    roles: ['reader', 'admin'],
    profiles: {small: {width: 360, height: 640}, large: {width: 900, height: 700}}
  });
  const browsers = launcher();
  const result = await build(f, browsers.launch);
  assert.equal(result.code, 0);
  const profiles = selectProfiles(result.input.config);
  const smallMap = await manifestAt(result.input.output, 'small');
  const largeMap = await manifestAt(result.input.output, 'large');
  const roles = (await f.store.load()).roles;
  const reader = smallMap.screens.find(screen => screen.id === roles.find(role => role.tag === 'reader').id + ':list');
  const admin = largeMap.screens.find(screen => screen.id === roles.find(role => role.tag === 'admin').id + ':list');
  const small = await standardLiveSessions(result.input, profiles[0], browsers.launch);
  const large = await standardLiveSessions(result.input, profiles[1], browsers.launch);
  f.cleanupLive = () => Promise.all([small.shutdown(), large.shutdown()]);
  await small.open({screenId: reader.id, captureId: reader.captureId, requestId: 'reader-live'});
  await large.open({screenId: admin.id, captureId: admin.captureId, requestId: 'admin-live'});
  const a = await sessionRecord(f, reader.captureId, reader.id);
  const b = await sessionRecord(f, admin.captureId, admin.id);
  assert.notEqual(a.pid, b.pid);
  assert.notEqual(a.endpoint, b.endpoint);
  assert.equal((await stat(join(f.directory, 'local/sessions', a.file))).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.directory, 'local/sessions'))).mode & 0o777, 0o700);
  const first = browsers.browsers.get(a.pid);
  const second = browsers.browsers.get(b.pid);
  const pageA = first.contexts()[0].pages()[0];
  const pageB = second.contexts()[0].pages()[0];
  assert.deepEqual(pageA.viewportSize(), profiles[0].viewport);
  assert.deepEqual(pageB.viewportSize(), profiles[1].viewport);
  assert.equal(await pageA.getByText('reader 身份', {exact: true}).isVisible(), true);
  assert.equal(await pageB.getByText('admin 身份', {exact: true}).isVisible(), true);
  await pageA.getByRole('button', {name: '计数 0', exact: true}).click();
  assert.equal(await pageA.getByRole('button', {name: '计数 1', exact: true}).isVisible(), true);
  assert.equal(await pageB.getByRole('button', {name: '计数 0', exact: true}).isVisible(), true);
  await small.close();
  assert.equal(await stopped(a.pid), true);
  assert.equal(await pageB.getByText('admin 身份', {exact: true}).isVisible(), true);
  assert.equal(await sessionRecord(f, reader.captureId, reader.id), undefined);
  await pageB.close();
  for (let i = 0; i < 100 && large.status().state !== 'idle'; i++) await new Promise(done => setTimeout(done, 20));
  assert.equal(large.status().state, 'idle');
  assert.equal(await stopped(b.pid), true);
  for (let i = 0; i < 100 && (await sessionRecord(f, admin.captureId, admin.id)); i++)
    await new Promise(done => setTimeout(done, 20));
  assert.equal(await sessionRecord(f, admin.captureId, admin.id), undefined);
});

test('构建记录校验后、实时快照读取前变化配置必须拒绝旧图谱', async t => {
  const f = await fixture(t);
  const browsers = launcher();
  const result = await build(f, browsers.launch);
  assert.equal(result.code, 0);
  const manifest = await manifestAt(result.input.output);
  const profile = selectProfiles(result.input.config)[0];
  const manager = await standardLiveSessions(result.input, profile, browsers.launch);
  f.cleanupLive = () => manager.shutdown();
  const directory = await realpath(f.directory);
  const original = fsPromises.readFile;
  let armed = false,
    changed = false;
  fsPromises.readFile = async (...args) => {
    const value = await original(...args);
    const path = String(args[0]);
    if (path === join(directory, 'build-state', manifest.generationId + '.json') && !changed) {
      changed = true;
      await writeFile(f.file, (await original(f.file, 'utf8')).replace('timeoutMs: 700', 'timeoutMs: 701'));
    }
    return value;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      manager.open({screenId: manifest.screens[0].id, captureId: manifest.captureId, requestId: 'read-race'}),
      /配置或凭据已变化/
    );
    assert.equal(changed, true);
  } finally {
    fsPromises.readFile = original;
    syncBuiltinESMExports();
  }
});
test('两个Viewer读取同capture时记录各属自身，关闭旧会话不会删除新会话记录或浏览器', async t => {
  const f = await fixture(t, {roles: ['reader', 'admin']});
  const browsers = launcher();
  const result = await build(f, browsers.launch);
  assert.equal(result.code, 0);
  const manifest = await manifestAt(result.input.output);
  const profile = selectProfiles(result.input.config)[0];
  const first = await standardLiveSessions(result.input, profile, browsers.launch);
  const second = await standardLiveSessions(result.input, profile, browsers.launch);
  f.cleanupLive = () => Promise.all([first.shutdown(), second.shutdown()]);
  const [reader, admin] = manifest.screens.filter(screen => screen.id.endsWith(':list'));
  await first.open({screenId: reader.id, captureId: reader.captureId, requestId: 'first-viewer'});
  await second.open({screenId: admin.id, captureId: admin.captureId, requestId: 'second-viewer'});
  const a = await sessionRecord(f, reader.captureId, reader.id);
  const b = await sessionRecord(f, admin.captureId, admin.id);
  assert.ok(a, '第一Viewer的私有会话记录缺失');
  assert.ok(b, '第二Viewer的私有会话记录缺失');
  assert.notEqual(a.file, b.file);
  await first.close();
  assert.equal(await sessionRecord(f, reader.captureId, reader.id), undefined);
  assert.equal((await sessionRecord(f, admin.captureId, admin.id)).pid, b.pid);
  assert.equal(
    await browsers.browsers
      .get(b.pid)
      .contexts()[0]
      .pages()[0]
      .getByRole('button', {name: '计数 0', exact: true})
      .isVisible(),
    true
  );
  await second.close();
  assert.equal(await sessionRecord(f, admin.captureId, admin.id), undefined);
  assert.equal(await stopped(a.pid), true);
  assert.equal(await stopped(b.pid), true);
});

test('同账户重复路由在启动 Chrome 前拒绝，不发布状态图谱', async t => {
  const f = await fixture(t);
  const config = parse(await readFile(f.file, 'utf8'));
  config.screens[1].route = config.screens[0].route;
  await writeFile(f.file, stringify(config));
  const browsers = launcher();
  const result = await build(f, browsers.launch);
  assert.equal(result.code, 1);
  const attempt = await json(join(result.input.output, 'latest-attempt.json'));
  assert.equal(attempt.status, 'failed');
  assert.match(attempt.error, /Duplicate route/);
  assert.equal(browsers.pids.length, 0);
  await assert.rejects(stat(join(result.input.output, 'manifest.json')), {code: 'ENOENT'});
});

test('认证模块诊断即使带安全前缀也不能把密码写入公开产物和日志', async t => {
  const f = await fixture(t);
  await writeFile(
    join(f.directory, 'diagnostic-auth.mjs'),
    `export default {version:'test-1',async login({credentials}) {throw Error('页面就绪失败：'+credentials.password);},async verify(){return {authenticated:false};}};`
  );
  const {project} = await f.store.load();
  await f.store.saveProject({...project, authentication: {type: 'module', module: './diagnostic-auth.mjs'}});
  const result = await cliBuild(f.root);
  assert.equal(result.code, 1);
  assert.ok(!result.stdout.includes('standard-private-password'), 'stdout 泄露密码');
  assert.ok(!result.stderr.includes('standard-private-password'), 'stderr 泄露密码');
  for (const [path, body] of await artifacts(f.directory))
    assert.ok(!body.includes('standard-private-password'), `模块诊断泄露密码 ${path}`);
});
