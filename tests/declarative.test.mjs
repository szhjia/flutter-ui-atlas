import {test} from 'node:test';
import assert from 'node:assert/strict';
import {declarativeConfig} from '../packages/capture/declarative.mjs';
import {localWebDiscovery} from '../packages/cli/local-web.mjs';

const state = {id: 'start', title: '入口', route: '/home', ready: {role: 'heading', name: '首页'}};

test('声明式配置区分 hash 和 pathname，并保留入口查询参数', async () => {
  const baseUrl = 'http://127.0.0.1:7070/app/';
  const screen = {...state, entry: 'index.html?mode=demo'};
  for (const [routeMode, expected] of [
    ['hash', 'http://127.0.0.1:7070/app/index.html?mode=demo#/home'],
    ['pathname', 'http://127.0.0.1:7070/home?mode=demo'],
  ]) {
    const {adapter, previewUrls} = declarativeConfig({baseUrl, routeMode, screens: [screen]}, '/tmp');
    const {screens} = await adapter.catalog();
    assert.equal(screens[0].entry, expected);
    assert.equal(screens[0].route, '/home');
    assert.equal(previewUrls.start, expected);
  }
});

test('没有点击定义的关系只声明，拒绝跨源入口和未登记的内容判据', async () => {
  const baseUrl = 'http://127.0.0.1:7070/';
  const edge = {id: 'e', source: 'start', target: 'start', action: '刷新'};
  const {adapter} = declarativeConfig({baseUrl, screens: [state], edges: [edge]}, '/tmp');
  assert.equal((await adapter.catalog()).edges[0].verify, false);
  assert.throws(() => declarativeConfig({baseUrl, screens: [{...state, entry: 'http://127.0.0.1:7071'}]}, '/tmp'), /同源/);
  assert.throws(() => declarativeConfig({baseUrl, screens: [{...state, ready: {}}]}, '/tmp'), /ready/);
  assert.throws(() => declarativeConfig({baseUrl, screens: [state], edges: [{...edge, click: {text: '刷新'}}]}, '/tmp'), /click/);
});

test('外网 baseUrl 默认拒绝并提示逃生口，allowRemoteUrls 放行', async () => {
  const remote = {baseUrl: 'https://dev.example.com', routeMode: 'hash', screens: [state]};
  assert.throws(() => declarativeConfig(remote, '/tmp'), /allowRemoteUrls/);
  const {adapter} = declarativeConfig({...remote, allowRemoteUrls: true}, '/tmp');
  const {screens} = await adapter.catalog();
  assert.equal(screens[0].entry, 'https://dev.example.com/#/home');
  assert.throws(() => declarativeConfig({...remote, allowRemoteUrls: 'yes'}, '/tmp'), /allowRemoteUrls 必须是布尔值/);
});

test('pathname 模式支持 routePrefix，route 存完整路径保持匹配对称', async () => {
  const config = {
    baseUrl: 'http://127.0.0.1:7070/', routeMode: 'pathname', routePrefix: '/app',
    screens: [{...state, entry: 'index.html'}],
  };
  const {adapter, previewUrls} = declarativeConfig(config, '/tmp');
  const {screens} = await adapter.catalog();
  assert.equal(screens[0].entry, 'http://127.0.0.1:7070/app/home');
  assert.equal(screens[0].route, '/app/home');
  assert.equal(previewUrls.start, 'http://127.0.0.1:7070/app/home');
  assert.throws(() => declarativeConfig({...config, routePrefix: 'app'}, '/tmp'), /routePrefix/);
  assert.throws(() => declarativeConfig({...config, routePrefix: '/a/'}, '/tmp'), /routePrefix/);
});

test('hash 模式忽略 routePrefix', async () => {
  const {adapter} = declarativeConfig({
    baseUrl: 'http://127.0.0.1:7070/', routeMode: 'hash', routePrefix: '/app', screens: [state],
  }, '/tmp');
  const {screens} = await adapter.catalog();
  assert.equal(screens[0].entry, 'http://127.0.0.1:7070/#/home');
  assert.equal(screens[0].route, '/home');
});

test('routePrefix 拒绝点段（含编码形态）与控制字符', () => {
  const config = {baseUrl: 'http://127.0.0.1:7070/', routeMode: 'pathname', screens: [state]};
  assert.throws(() => declarativeConfig({...config, routePrefix: '/app/%2e%2e'}, '/tmp'), /routePrefix/);
  assert.throws(() => declarativeConfig({...config, routePrefix: '/a/../b'}, '/tmp'), /routePrefix/);
  assert.throws(() => declarativeConfig({...config, routePrefix: `/a${String.fromCharCode(10)}b`}, '/tmp'), /routePrefix/);
});

test('entryMode 型 baseUrl 默认限回环，allowRemote 转发放行（评审 Important #1）', () => {
  const remote = 'https://dev.example.com';
  assert.throws(() => localWebDiscovery(remote, undefined, {label: 'baseUrl'}), /allowRemoteUrls/);
  const discovery = localWebDiscovery(remote, undefined, {allowRemote: true, label: 'baseUrl'});
  assert.equal(typeof discovery.candidates, 'function');
  assert.throws(() => localWebDiscovery(remote, undefined), /--url/);
});

test('routePrefix 拒绝反斜杠、编码反斜杠和编码控制字符', () => {
  const config = {baseUrl: 'http://127.0.0.1:7070/', routeMode: 'pathname', screens: [state]};
  for (const routePrefix of [String.raw`/app\..\outside`, '/app/%5c..%5coutside', '/app/%0aoutside', '/app/%7foutside', '/app/%5c%FF', '/app/%0a%', '/app/%7f%ZZ']) {
    assert.throws(() => declarativeConfig({...config, routePrefix}, '/tmp'), /routePrefix/);
  }
});

test('最终 pathname 不能经页面 route 的规范化离开前缀，合法编码目录仍可用', async () => {
  const config = {baseUrl: 'http://127.0.0.1:7070/', routeMode: 'pathname', routePrefix: '/app'};
  for (const route of ['/../outside', '/%2e%2e/outside', String.raw`/..\outside`]) {
    assert.throws(() => declarativeConfig({...config, screens: [{...state, route}]}, '/tmp'), /routePrefix/);
  }
  const {adapter} = declarativeConfig({...config, routePrefix: '/演示', screens: [state]}, '/tmp');
  assert.equal((await adapter.catalog()).screens[0].route, '/%E6%BC%94%E7%A4%BA/home');
});
