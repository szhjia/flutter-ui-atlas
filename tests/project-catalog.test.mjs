import test from 'node:test';
import assert from 'node:assert/strict';
import * as project from '../packages/cli/project.mjs';
import {matchesReady} from '../packages/cli/browser-actions.mjs';
import {validateCatalog} from '../packages/capture/index.mjs';

const roles = [
  {id: 'stable-one', tag: 'user1', name: '用户一', enabled: true, credentials: {username: 'one', password: 'secret'}},
  {id: 'stable-two', tag: 'user2', name: '用户二', enabled: false, credentials: {username: 'two', password: 'secret'}}
];
const config = {
  baseUrl: 'http://127.0.0.1:8080/',
  authentication: {type: 'form'},
  screens: [
    {id: 'login', title: '登录', route: '/login', roles: ['@anonymous'], ready: {text: '登录'}},
    {
      id: 'home',
      title: '首页',
      route: '/home',
      ready: {all: [{text: '首页'}, {kind: 'label', name: '账户 {{role.username}}'}]},
      prepare: []
    }
  ],
  edges: [
    {
      id: 'enter',
      source: 'home',
      target: 'login',
      action: '退出',
      steps: [{action: 'click', target: {role: 'button', name: '退出'}}]
    }
  ]
};

test('目录按启用账户展开，匿名共享，页面身份由稳定UUID保持', () => {
  const catalog = project.expandCatalog?.(config, roles);
  assert.deepEqual(
    catalog?.screens.map(s => [s.id, s.role]),
    [
      ['@anonymous:login', 'Signed out'],
      ['stable-one:home', '用户一']
    ]
  );
  assert.equal(catalog.screens[1].ready.all[1].name, '账户 one');
  assert.equal(catalog.screens[0].group, 'Screens');
  assert.equal(catalog.screens[1].title, '首页');
  assert.deepEqual(
    catalog.edges.map(e => [e.source, e.target]),
    [['stable-one:home', '@anonymous:login']]
  );
  const changed = roles.map(r => ({...r, tag: r.tag + '-new', name: r.name + '改名'}));
  assert.equal(project.expandCatalog(config, changed).screens[1].id, 'stable-one:home');
});

test('角色范围与密码变量在打开浏览器前拒绝，无启用账户不伪装成匿名', () => {
  assert.throws(
    () => project.expandCatalog({...config, screens: [{...config.screens[1], roles: ['missing']}]}, roles),
    /角色/
  );
  assert.throws(
    () =>
      project.expandCatalog({...config, screens: [{...config.screens[1], ready: {text: '{{role.password}}'}}]}, roles),
    /变量/
  );
  assert.throws(
    () =>
      project.expandCatalog(
        {...config, screens: [config.screens[1]]},
        roles.map(r => ({...r, enabled: false}))
      ),
    /启用账户|目录/
  );
  assert.throws(
    () => project.expandCatalog(config, [{...roles[0], credentials: {username: 'one', password: ''}}]),
    /凭据/
  );
});

test('声明式判据和步骤在启动浏览器前校验，路径模式保留前缀', () => {
  assert.throws(
    () => project.expandCatalog({...config, edges: [], screens: [{...config.screens[1], ready: {all: []}}]}, roles),
    /判据|all/
  );
  assert.throws(
    () =>
      project.expandCatalog(
        {...config, edges: [], screens: [{...config.screens[1], prepare: [{action: 'shell', command: 'flutter run'}]}]},
        roles
      ),
    /操作/
  );
  assert.throws(() => project.expandCatalog({...config, timeoutMs: 0}, roles), /timeoutMs/);
  const catalog = project.expandCatalog({...config, routeMode: 'pathname', routePrefix: '/app'}, roles);
  assert.equal(catalog.screens[1].route, '/app/home');
});

test('标准YAML保留pathname部署目录与routePrefix格式边界', () => {
  const plain = {
    baseUrl: 'http://127.0.0.1:8080/',
    routeMode: 'pathname',
    routePrefix: '/app',
    screens: [{id: 'home', title: '首页', route: '/../admin', ready: {text: '正文'}}],
    edges: []
  };
  assert.throws(() => project.expandCatalog(plain), /routePrefix|目录/);
  for (const routePrefix of ['/app/', '//host', '/app/../other', '/app/%2e%2e'])
    assert.throws(
      () => project.expandCatalog({...plain, routePrefix, screens: [{...plain.screens[0], route: '/home'}]}),
      /routePrefix/
    );
});

test('部署前缀中的中文和空格沿用URL编码后的有效路径', () => {
  for (const prefix of ['/中文', '/my app']) {
    const catalog = project.expandCatalog({
      baseUrl: 'http://127.0.0.1:8080/',
      routeMode: 'pathname',
      routePrefix: prefix,
      screens: [{id: 'home', title: '首页', route: '/home', ready: {text: '正文'}}],
      edges: []
    });
    assert.equal(catalog.screens[0].route, new URL(prefix + '/home', 'http://localhost').pathname);
  }
});

test('hash页面的中文、空格及已有编码与实际就绪判据匹配', async () => {
  const baseUrl = 'http://127.0.0.1:8080/';
  for (const [route, expected] of [
    ['/商品', '/%E5%95%86%E5%93%81'],
    ['/my app', '/my%20app'],
    ['/%E5%95%86%E5%93%81', '/%E5%95%86%E5%93%81'],
    ['/goods', '/goods'],
    ['/', '/']
  ]) {
    const {
      screens: [screen]
    } = project.expandCatalog({
      baseUrl,
      routeMode: 'hash',
      screens: [{id: 'page', title: '页面', route, ready: {text: '正文'}}]
    });
    assert.equal(screen.route, expected, route);
    assert.equal(
      await matchesReady({url: () => screen.entry}, {route: screen.route}, {baseUrl, entry: screen.entry}),
      true,
      route
    );
  }
});

test('匿名与账户共用页面时保留全部合法端点且连线ID唯一稳定', () => {
  const mixed = {
    baseUrl: config.baseUrl,
    authentication: config.authentication,
    screens: ['source', 'target'].map(id => ({
      id,
      title: id,
      route: '/' + id,
      roles: ['@anonymous', 'user1', 'user2'],
      ready: {text: '正文'}
    })),
    edges: [{id: 'go', source: 'source', target: 'target', action: '前往 {{role.name}}', steps: []}]
  };
  const catalog = project.expandCatalog(mixed, roles);
  assert.equal(catalog.edges.length, 4);
  assert.equal(new Set(catalog.edges.map(edge => edge.id)).size, 4);
  assert.deepEqual(
    new Set(catalog.edges.map(edge => [edge.source, edge.target].join(' -> '))),
    new Set([
      '@anonymous:source -> @anonymous:target',
      '@anonymous:source -> stable-one:target',
      'stable-one:source -> @anonymous:target',
      'stable-one:source -> stable-one:target'
    ])
  );
  assert.doesNotThrow(() => validateCatalog(catalog));
  assert.equal(
    catalog.edges.find(edge => edge.source === '@anonymous:source' && edge.target === 'stable-one:target').action,
    '前往 用户一'
  );
  const renamed = project.expandCatalog(
    {
      ...mixed,
      screens: [...mixed.screens].reverse().map(screen => ({
        ...screen,
        roles: ['user2', 'renamed', '@anonymous']
      }))
    },
    roles.map(role => (role.enabled ? {...role, tag: 'renamed', name: '新名称'} : role))
  );
  const identities = value =>
    value.edges.map(({id, source, target}) => ({id, source, target})).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(identities(renamed), identities(catalog));
});
