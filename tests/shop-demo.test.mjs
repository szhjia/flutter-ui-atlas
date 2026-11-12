import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {expandCatalog, selectProfiles} from '../packages/cli/project.mjs';

const source = new URL('./helpers/shop-catalog.yaml', import.meta.url);
const roles = ['user1', 'user2'].map((tag, index) => ({
  id: `shop-account-${index + 1}`,
  tag,
  name: `商城用户${index + 1}`,
  enabled: true,
  credentials: {username: tag, password: 'unit-test-only'}
}));

test('普通商城声明展开为 16 个真实状态与 21 项操作，匿名状态共享', async () => {
  const config = parse(await readFile(source, 'utf8'));
  const catalog = expandCatalog({...config, authentication: {type: 'form'}}, roles);
  assert.equal(catalog.screens.length, 16);
  assert.equal(new Set(catalog.screens.map(screen => screen.id)).size, 16);
  assert.equal(catalog.edges.length, 21);
  assert.equal(catalog.screens.filter(screen => screen.id.startsWith('@anonymous:')).length, 2);
  assert(
    config.screens
      .find(screen => screen.id === 'login')
      .ready.all.some(condition => condition.not?.text === '账号或密码错误')
  );
  for (const role of roles) {
    assert.equal(catalog.screens.filter(screen => screen.id.startsWith(role.id + ':')).length, 7);
    assert(
      catalog.screens
        .find(screen => screen.id === `${role.id}:home`)
        .ready.all.some(item => item.text === `当前账户：${role.credentials.username}`)
    );
    const login = catalog.edges.find(edge => edge.source === '@anonymous:login' && edge.target === `${role.id}:home`);
    assert.deepEqual(login.steps, [], '登录使用配置认证，不在目录中填入密码');
    const logout = catalog.edges.find(edge => edge.source === `${role.id}:me` && edge.target === '@anonymous:login');
    assert.deepEqual(logout.steps, [{action: 'click', target: {role: 'button', name: '退出登录'}}]);
  }
  const ids = new Set(catalog.screens.map(screen => screen.id));
  assert(catalog.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)));
});

test('phone/pad 通过标准 YAML profiles 声明，目录不携带凭据和预览注入', async () => {
  const text = await readFile(source, 'utf8');
  const config = parse(text);
  assert.deepEqual(
    selectProfiles(config).map(profile => [profile.name, profile.viewport]),
    [
      ['phone', {width: 393, height: 852}],
      ['pad', {width: 1024, height: 768}]
    ]
  );
  assert(!text.includes('1234.com'));
  assert(!text.includes('role.password'));
  assert(!text.includes('credentials'));
  assert(!/atlasSession|demoAccount|demoCart|demoError|adapterConfig/.test(text));
  assert(config.screens.every(screen => Array.isArray(screen.ready.all) && screen.ready.all.length >= 2));
  const actions = new Set(config.screens.flatMap(screen => screen.prepare).map(step => step.action));
  assert.deepEqual([...actions].sort(), ['click', 'fill', 'goto', 'wait']);
});

test('购物车和商品详情就绪要求正文、身份与数量，不能只看标题或顶部徽标', async () => {
  const config = parse(await readFile(source, 'utf8'));
  const find = id => config.screens.find(screen => screen.id === id).ready.all;
  assert(find('cart-full').some(item => item.text === '合计 ¥69.00'));
  assert(find('cart-full').some(item => item.role === 'group' && item.name === '轻量随行杯 ¥69.00 轻量随行杯数量：1'));
  assert(find('cart-empty').some(item => item.text === '购物车还是空的'));
  assert(find('detail').some(item => item.role === 'heading' && item.name === '轻量随行杯'));
  assert(find('detail').some(item => item.text === '¥69.00'));
  for (const screen of config.screens.filter(screen => !screen.roles?.includes('@anonymous'))) {
    assert(screen.ready.all.some(item => item.text === '当前账户：{{role.username}}'));
    assert(screen.ready.all.some(item => /^购物车数量：[01]$/.test(item.name ?? '')));
  }
});

test('自适应导航声明两种真实语义定位器，保留实际点击', async () => {
  const config = parse(await readFile(source, 'utf8'));
  const profile = config.edges.find(edge => edge.id === 'profile');
  assert.deepEqual(profile.steps, [
    {
      action: 'click',
      target: {
        any: [
          {role: 'tab', name: '我的'},
          {role: 'button', name: '我的 Tab 3 of 3'}
        ]
      }
    }
  ]);
});
