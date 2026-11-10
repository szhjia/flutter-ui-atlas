import {test} from 'node:test';
import assert from 'node:assert/strict';
import {declarativeConfig} from '../packages/capture/declarative.mjs';

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
