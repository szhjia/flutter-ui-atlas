import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDiscovery, hashRouteOf, parseRouteDeclarations} from '../examples/atlas-discovery.mjs';

test('parseRouteDeclarations 解析单行与无 const 声明', () => {
  const code = [
    `      '/': (context) => const ExamplePage(title: '欢迎', next: '/home'),`,
    `      '/home': (context) => ExamplePage(title: '项目列表'),`,
  ].join('\n');
  const routes = parseRouteDeclarations(code);
  assert.deepEqual([...routes.keys()], ['/', '/home']);
  assert.equal(routes.get('/home').title, '项目列表');
});

test('parseRouteDeclarations 支持多行声明', () => {
  const code = [
    `      '/detail': (context) => ExamplePage(`,
    `        title: '项目详情',`,
    `        next: '/settings',`,
    `      ),`,
  ].join('\n');
  const routes = parseRouteDeclarations(code);
  assert.equal(routes.get('/detail').title, '项目详情');
});

test('hashRouteOf 剥离 fragment 内查询参数，空与根等价于 /', () => {
  assert.equal(hashRouteOf(new URL('http://127.0.0.1:60210/#/home?tab=1')), '/home');
  assert.equal(hashRouteOf(new URL('http://127.0.0.1:60210/')), '/');
  assert.equal(hashRouteOf(new URL('http://127.0.0.1:60210/#')), '/');
  assert.equal(hashRouteOf(new URL('http://127.0.0.1:60210/#/')), '/');
});

test('路由表源码 0 命中时给出可行动诊断（依赖注入）', async () => {
  const discovery = buildDiscovery({readFile: async () => "void main() {}"});
  await assert.rejects(discovery.candidates(), /没有匹配到任何 ExamplePage/);
});

test('真实示例 main.dart 解析出 4 条路由（防格式漂移）', async () => {
  const candidates = await buildDiscovery().candidates();
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates.map(c => c.route).sort(), ['/', '/detail', '/home', '/settings']);
});
