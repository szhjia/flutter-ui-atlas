import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {expandCatalog, selectProfiles} from '../packages/cli/project.mjs';

const source = new URL('./helpers/shop-catalog.yaml', import.meta.url);
const roles = ['user1', 'user2'].map((tag, index) => ({
  id: `shop-account-${index + 1}`,
  tag,
  name: `Shop user ${index + 1}`,
  enabled: true,
  credentials: {username: tag, password: 'unit-test-only'}
}));

test('The shop catalog expands to 16 states and 21 actions with shared anonymous states', async () => {
  const config = parse(await readFile(source, 'utf8'));
  const catalog = expandCatalog({...config, authentication: {type: 'form'}}, roles);
  assert.equal(catalog.screens.length, 16);
  assert.equal(new Set(catalog.screens.map(screen => screen.id)).size, 16);
  assert.equal(catalog.edges.length, 21);
  assert.equal(catalog.screens.filter(screen => screen.id.startsWith('@anonymous:')).length, 2);
  assert(
    config.screens
      .find(screen => screen.id === 'login')
      .ready.all.some(condition => condition.not?.text === 'Incorrect username or password')
  );
  for (const role of roles) {
    assert.equal(catalog.screens.filter(screen => screen.id.startsWith(role.id + ':')).length, 7);
    assert(
      catalog.screens
        .find(screen => screen.id === `${role.id}:home`)
        .ready.all.some(item => item.text === `Account: ${role.credentials.username}`)
    );
    const login = catalog.edges.find(edge => edge.source === '@anonymous:login' && edge.target === `${role.id}:home`);
    assert.deepEqual(login.steps, [], 'Sign-in uses configured authentication, keeping passwords out of the catalog');
    const logout = catalog.edges.find(edge => edge.source === `${role.id}:me` && edge.target === '@anonymous:login');
    assert.deepEqual(logout.steps, [{action: 'click', target: {role: 'button', name: 'Sign out'}}]);
  }
  const ids = new Set(catalog.screens.map(screen => screen.id));
  assert(catalog.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)));
});

test('Phone and pad use standard YAML profiles without passwords or preview injection', async () => {
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

test('Cart and product readiness checks include content, identity, and quantity', async () => {
  const config = parse(await readFile(source, 'utf8'));
  const find = id => config.screens.find(screen => screen.id === id).ready.all;
  assert(find('cart-full').some(item => item.text === 'Total ¥69.00'));
  assert(
    find('cart-full').some(item => item.role === 'group' && item.name === 'Travel cup ¥69.00 Travel cup quantity: 1')
  );
  assert(find('cart-empty').some(item => item.text === 'Your cart is empty'));
  assert(find('detail').some(item => item.role === 'heading' && item.name === 'Travel cup'));
  assert(find('detail').some(item => item.text === '¥69.00'));
  for (const screen of config.screens.filter(screen => !screen.roles?.includes('@anonymous'))) {
    assert(screen.ready.all.some(item => item.text === 'Account: {{role.username}}'));
    assert(screen.ready.all.some(item => /^Cart items: [01]$/.test(item.name ?? '')));
  }
});

test('Responsive navigation declares both semantic locators and uses real clicks', async () => {
  const config = parse(await readFile(source, 'utf8'));
  const profile = config.edges.find(edge => edge.id === 'profile');
  assert.deepEqual(profile.steps, [
    {
      action: 'click',
      target: {
        any: [
          {role: 'tab', name: 'Profile'},
          {role: 'button', name: 'Profile Tab 3 of 3'}
        ]
      }
    }
  ]);
});
