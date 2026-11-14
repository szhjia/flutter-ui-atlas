import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCatalog} from '../packages/capture/index.mjs';
import {expandCatalog} from '../packages/cli/project-catalog.mjs';
import {declarativeConfig} from '../packages/capture/declarative.mjs';
const page = (id, extra = {}) => ({
  id,
  role: 'Signed out',
  entry: 'http://127.0.0.1:60212/#/login',
  route: '/login',
  title: 'Sign in',
  group: 'Auth',
  state: 'Default',
  ...extra
});

test('same-account same-route variants are rejected even with different IDs and states', () => {
  assert.throws(
    () => validateCatalog({screens: [page('login'), page('error', {state: 'Wrong password'})], edges: []}),
    /duplicate route/i
  );
});
test('different stable accounts with identical display names remain separate pages', () => {
  assert.doesNotThrow(() =>
    validateCatalog({
      screens: [page('one', {accountId: 'uuid-one', role: 'User'}), page('two', {accountId: 'uuid-two', role: 'User'})],
      edges: []
    })
  );
});
test('query and hash state parameters do not create another route page', () => {
  assert.throws(
    () =>
      validateCatalog({
        screens: [page('a'), page('b', {entry: 'http://127.0.0.1:60212/?theme=dark#/login?error=1'})],
        edges: []
      }),
    /duplicate route/i
  );
});
test('an in-page action cannot be declared as a navigation self-loop', () => {
  assert.throws(
    () =>
      validateCatalog({
        screens: [page('login')],
        edges: [{id: 'error', source: 'login', target: 'login', action: 'Wrong password'}]
      }),
    /navigation|same page/i
  );
});
test('managed YAML rejects route variants before browser or live-session creation', () => {
  const config = {
    baseUrl: 'http://127.0.0.1:60212/',
    screens: [page('login', {ready: {text: 'Sign in'}}), page('error', {ready: {text: 'Wrong password'}})]
  };
  assert.throws(() => expandCatalog(config), /duplicate route/i);
});
test('simple declarative adapters enforce the same route uniqueness contract', () => {
  const config = {
    baseUrl: 'http://127.0.0.1:60212/',
    screens: [page('login', {ready: {text: 'Sign in'}}), page('error', {ready: {text: 'Wrong password'}})]
  };
  assert.throws(() => declarativeConfig(config, process.cwd()), /duplicate route/i);
});

test('route readiness can accept complete content alternatives without allowing compound click targets', async () => {
  const {validateCondition, validateSteps} = await import('../packages/cli/browser-actions.mjs');
  const ready = {
    any: [{all: [{text: 'Empty cart'}, {text: 'Browse shop'}]}, {all: [{text: 'Total 69'}, {text: 'Travel cup'}]}]
  };
  assert.doesNotThrow(() => validateCondition(ready));
  assert.throws(() => validateSteps([{action: 'click', target: ready}], 'http://127.0.0.1:8080/'), /locator|定位|目标/);
});
