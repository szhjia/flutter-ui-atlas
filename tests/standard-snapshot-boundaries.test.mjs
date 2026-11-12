import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parse, stringify} from 'yaml';
import {standardFixture} from './helpers/standard-application.mjs';
import {resolveProjectConfig, selectProfiles} from '../packages/cli/project.mjs';
import {buildStandard, standardLiveSessions} from '../packages/cli/managed-workflow.mjs';
import {launchManagedBrowser} from '../packages/cli/managed-browser.mjs';
async function inputFor(f) {
  const input = await resolveProjectConfig({cwd: f.root});
  return {...input, output: resolve(input.directory, input.config.output ?? 'generated'), publicPath: '/generated'};
}
for (const field of ['profiles', 'requireObservedEdges', 'output'])
  test(`CLI初读与快照间${field}变化不能混合发布`, async t => {
    const f = await standardFixture({profiles: {phone: {width: 360, height: 640}}});
    t.after(f.cleanup);
    const input = await inputFor(f),
      profiles = selectProfiles(input.config);
    const current = parse(await readFile(f.file, 'utf8'));
    if (field === 'profiles') current.profiles.phone.width = 600;
    else if (field === 'output') current.output = 'other-output';
    else current.requireObservedEdges = !current.requireObservedEdges;
    await writeFile(f.file, stringify(current));
    await assert.rejects(
      buildStandard(input, profiles, () => launchManagedBrowser()),
      /配置.*变化|重新运行/
    );
    await assert.rejects(readFile(join(input.output, 'phone/manifest.json')), /ENOENT/);
  });
test('实时会话拒绝源码已变化的成功图谱', async t => {
  const f = await standardFixture();
  t.after(f.cleanup);
  const source = join(f.root, 'lib/main.dart');
  await writeFile(source, 'original');
  const doc = parse(await readFile(f.file, 'utf8'));
  doc.sourceFiles = ['../lib/main.dart'];
  await writeFile(f.file, stringify(doc));
  const input = await inputFor(f),
    profile = selectProfiles(input.config)[0];
  assert.equal(await buildStandard(input, [profile], () => launchManagedBrowser()), 0);
  const manifest = JSON.parse(await readFile(join(input.output, 'manifest.json'), 'utf8'));
  await writeFile(source, 'changed');
  const manager = await standardLiveSessions(input, profile, () => launchManagedBrowser());
  t.after(() => manager.shutdown());
  await assert.rejects(
    manager.open({screenId: manifest.screens[0].id, captureId: manifest.captureId}),
    /源码.*变化|重新构建/
  );
});
test('相同hash和正文的同源错误入口不能通过标准采集', async t => {
  const f = await standardFixture();
  t.after(f.cleanup);
  const doc = parse(await readFile(f.file, 'utf8'));
  doc.screens = [{...doc.screens[0], entry: '/app2/', prepare: [{goto: '/app1/#/shared'}]}];
  doc.edges = [];
  await writeFile(f.file, stringify(doc));
  const input = await inputFor(f),
    profiles = selectProfiles(input.config);
  assert.equal(await buildStandard(input, profiles, () => launchManagedBrowser()), 1);
  await assert.rejects(readFile(join(input.output, 'manifest.json')), /ENOENT/);
});
