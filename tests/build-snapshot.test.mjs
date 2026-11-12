import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {configFixture, configure, draft} from './helpers/config-fixtures.mjs';
import * as project from '../packages/cli/project.mjs';

test('构建快照读取配置页账户，公开配置不暴露密码，凭据变更使旧快照失效', async t => {
  const fixture = await configFixture();
  t.after(fixture.cleanup);
  await configure(fixture.store);
  const role = await fixture.store.saveRole(draft());
  const snapshot = await fixture.store.readBuildSnapshot?.();
  assert.deepEqual(
    snapshot?.roles.map(r => [r.id, r.tag, r.credentials.username, r.credentials.password]),
    [[role.id, 'reader', 'reader@example.test', 'example-password']]
  );
  assert(!JSON.stringify(await fixture.store.load()).includes('example-password'));
  await snapshot.assertCurrent();
  await fixture.store.saveRole({...draft(), id: role.id, revision: role.revision, password: 'new-password'});
  await assert.rejects(snapshot.assertCurrent(), /配置或凭据已变化/);
});

test('构建快照不被后续配置修改，并保留步骤与视口字段', async t => {
  const fixture = await configFixture();
  t.after(fixture.cleanup);
  await configure(fixture.store);
  const file = join(fixture.directory, 'atlas.yaml');
  await writeFile(
    file,
    (await readFile(file, 'utf8')) +
      '\nprofiles: {phone: {width: 393, height: 852}}\nscreens: [{id: home, route: /home, title: 首页, ready: {text: 首页}, prepare: []}]\n'
  );
  const snapshot = await fixture.store.readBuildSnapshot?.();
  assert.equal(snapshot?.config.profiles.phone.width, 393);
  const current = (await fixture.store.load()).project;
  await fixture.store.saveProject({...current, name: '修改后的名称'});
  assert.equal(snapshot.config.title, 'config_example');
  await assert.rejects(snapshot.assertCurrent(), /配置或凭据已变化/);
  assert.equal((await fixture.store.readBuildSnapshot()).config.screens[0].id, 'home');
});

test('命名视口默认全部选择，指定视口与旧单视口保持确定行为', () => {
  const config = {profiles: {phone: {width: 393, height: 852}, pad: {width: 1024, height: 768}}};
  assert.deepEqual(project.selectProfiles?.(config), [
    {name: 'phone', viewport: {width: 393, height: 852}},
    {name: 'pad', viewport: {width: 1024, height: 768}}
  ]);
  assert.deepEqual(project.selectProfiles(config, 'pad'), [{name: 'pad', viewport: {width: 1024, height: 768}}]);
  assert.deepEqual(project.selectProfiles({}), [{name: null, viewport: {width: 393, height: 852}}]);
  assert.throws(() => project.selectProfiles(config, 'unknown'), /视口/);
  assert.throws(() => project.selectProfiles({profiles: {phone: {width: 0, height: 8}}}), /视口/);
});

test('实时快照必须绑定原采集版本，配置变化不能被新快照洗白', async t => {
  const fixture = await configFixture();
  t.after(fixture.cleanup);
  await configure(fixture.store);
  const first = await fixture.store.readBuildSnapshot();
  const captureId = '2026-11-12T00-00-00-000Z';
  await first.recordBuild({captureId, profileName: null, viewport: {width: 393, height: 852}});
  const current = (await fixture.store.load()).project;
  await fixture.store.saveProject({...current, name: '已变化'});
  await assert.rejects(fixture.store.readBuildSnapshot({captureId}), /配置或凭据已变化/);
});
