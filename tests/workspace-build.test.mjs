import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {standardFixture} from './helpers/standard-application.mjs';
import {resolveProjectConfig, selectProfiles} from '../packages/cli/project.mjs';
import {buildWorkspaces, readWorkspaceManifest} from '../packages/cli/workspace-build.mjs';
import {launchManagedBrowser} from '../packages/cli/managed-browser.mjs';
import {draft} from './helpers/config-fixtures.mjs';
async function fixture(t) {
  const f = await standardFixture({roles: ['reader', 'admin']});
  t.after(() => f.cleanup());
  return f;
}
async function input(f) {
  const p = await resolveProjectConfig({cwd: f.root});
  return {...p, output: resolve(p.directory, p.config.output), publicPath: '/generated'};
}
test('cache is account-scoped, preserves evidence, supports offline hits, and force fails atomically', async t => {
  const f = await fixture(t);
  let launches = 0;
  const launch = async () => {
    launches++;
    return launchManagedBrowser({channel: 'chrome'});
  };
  let i = await input(f);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 2);
  const first = await readWorkspaceManifest(i.output);
  const raw = await readFile(join(i.output, 'index.json'), 'utf8');
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 2);
  assert.equal(await readFile(join(i.output, 'index.json'), 'utf8'), raw);
  const role = (await f.store.load()).roles[0];
  await f.store.saveRole(draft({...role, name: 'Renamed', password: ''}));
  i = await input(f);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 2);
  const renamed = await readWorkspaceManifest(i.output);
  assert.equal(renamed.workspaces[0].name, 'Renamed');
  assert.equal(renamed.captureId, first.captureId);
  // Only the changed account is recaptured; the other successful revision is retained.
  const admin = (await f.store.load()).roles[1];
  await f.store.saveRole(draft({...admin, password: 'wrong'}));
  i = await input(f);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 1);
  assert.equal((await readWorkspaceManifest(i.output)).generationId, renamed.generationId);
  await f.store.saveRole(draft({...(await f.store.load()).roles[1], password: 'standard-private-password'}));
  i = await input(f);
  await f.app.close();
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch, {force: true}), 1);
  assert.equal((await readWorkspaceManifest(i.output)).captureId, first.captureId);
});
test('corrupt referenced screenshot cannot hit the successful cache', async t => {
  const f = await fixture(t);
  let launches = 0;
  const launch = async () => {
    launches++;
    return launchManagedBrowser({channel: 'chrome'});
  };
  const i = await input(f);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  const before = await readWorkspaceManifest(i.output);
  await writeFile(join(i.output, before.screens[0].image.replace('/generated/', '')), 'broken');
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 3);
  assert.notEqual((await readWorkspaceManifest(i.output)).captureId, before.captureId);
});

test('a checksum record missing a referenced resource cannot hide a broken screenshot', async t => {
  const f = await fixture(t);
  const i = await input(f);
  let launches = 0;
  const launch = async () => {
    launches++;
    return launchManagedBrowser({channel: 'chrome'});
  };
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  const map = await readWorkspaceManifest(i.output);
  const stateFile = join(f.directory, 'build-state', map.generationId + '.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const resource = map.screens[0].image.replace('/generated/', '');
  for (const record of Object.values(state.records)) delete record.integrity[resource];
  await writeFile(stateFile, JSON.stringify(state));
  await writeFile(join(i.output, resource), 'corrupt');
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 3);
});

test('uncovered external source inputs prevent live sessions before browser launch', async t => {
  const f = await fixture(t);
  const {standardLiveSessions} = await import('../packages/cli/managed-workflow.mjs');
  await writeFile(
    join(f.root, 'pubspec.yaml'),
    (await readFile(join(f.root, 'pubspec.yaml'), 'utf8')) +
      '\ndependencies:\n  flutter:\n    sdk: flutter\n  outside:\n    path: ../outside\n'
  );
  // Keep one dependencies mapping in the minimal fixture.
  const {parse, stringify} = await import('yaml');
  let doc;
  try {
    doc = parse(await readFile(join(f.root, 'pubspec.yaml'), 'utf8'));
  } catch {
    doc = {name: 'fixture', dependencies: {flutter: {sdk: 'flutter'}, outside: {path: '../outside'}}};
    await writeFile(join(f.root, 'pubspec.yaml'), stringify(doc));
  }
  const i = await input(f);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), () => launchManagedBrowser({channel: 'chrome'})), 0);
  const map = await readWorkspaceManifest(i.output);
  let launches = 0;
  const live = await standardLiveSessions(i, selectProfiles(i.config)[0], async () => {
    launches++;
    throw Error('must not launch');
  });
  t.after(() => live.shutdown());
  await assert.rejects(
    live.open({screenId: map.screens[0].id, captureId: map.captureId, requestId: 'unsafe-source'}),
    /freshness cannot be verified/
  );
  assert.equal(launches, 0);
});

test('concurrent builders cannot interleave and index commit failure retains the previous generation', async t => {
  const f = await fixture(t);
  const i = await input(f);
  let entered;
  const started = new Promise(resolve => (entered = resolve));
  let unblock;
  const gate = new Promise(resolve => (unblock = resolve));
  const first = buildWorkspaces(i, selectProfiles(i.config), async () => {
    entered();
    await gate;
    return launchManagedBrowser({channel: 'chrome'});
  });
  await started;
  await assert.rejects(
    buildWorkspaces(i, selectProfiles(i.config), () => launchManagedBrowser({channel: 'chrome'})),
    /另一个写入任务|互斥/
  );
  unblock();
  assert.equal(await first, 0);
  const before = await readFile(join(i.output, 'index.json'), 'utf8');
  const fs = await import('node:fs/promises');
  const {syncBuiltinESMExports} = await import('node:module');
  const original = fs.default.rename;
  fs.default.rename = async (from, to) => {
    if (to === join(i.output, 'index.json')) throw Object.assign(Error('Injected index commit failure'), {code: 'EIO'});
    return original(from, to);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(
      await buildWorkspaces(i, selectProfiles(i.config), () => launchManagedBrowser({channel: 'chrome'}), {
        force: true
      }),
      1
    );
  } finally {
    fs.default.rename = original;
    syncBuiltinESMExports();
  }
  assert.equal(await readFile(join(i.output, 'index.json'), 'utf8'), before);
  assert.equal(
    await buildWorkspaces(i, selectProfiles(i.config), async () => {
      throw Error('cache should survive failed publication');
    }),
    0
  );
});

test('changing publicPath recaptures once and cached images render through the real Viewer', async t => {
  const f = await fixture(t);
  const {parse, stringify} = await import('yaml');
  const {serveViewer} = await import('../packages/cli/view-server.mjs');
  let launches = 0;
  const launch = () => {
    launches++;
    return launchManagedBrowser({channel: 'chrome'});
  };
  let i = await input(f);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  const first = await readWorkspaceManifest(i.output);
  const file = join(f.directory, 'atlas.yaml');
  const config = parse(await readFile(file, 'utf8'));
  config.publicPath = '/renamed';
  await writeFile(file, stringify(config));
  i = {...(await input(f)), publicPath: '/renamed'};
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 4);
  const fresh = await readWorkspaceManifest(i.output);
  assert.notEqual(fresh.captureId, first.captureId);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 4);
  const cached = await readWorkspaceManifest(i.output);
  assert.equal(cached.captureId, fresh.captureId);
  assert.equal(cached.capturedAt, fresh.capturedAt);
  const viewer = await serveViewer({
    config: {artifactPaths: ['/renamed']},
    port: 0,
    output: i.output,
    publicPath: '/renamed'
  });
  t.after(() => viewer.close());
  const browser = await launchManagedBrowser({channel: 'chrome'});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(viewer.url);
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.map-card img')];
    return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0);
  });
  assert.ok(
    await page
      .locator('.map-card img')
      .first()
      .getAttribute('src')
      .then(src => src.startsWith('/renamed/captures/'))
  );
});

test('corrupt reports preserve successful maps through HTTP, Chrome rendering and offline cache reuse', async t => {
  const f = await fixture(t);
  const i = await input(f);
  const {serveViewer} = await import('../packages/cli/view-server.mjs');
  const {annotateWorkspaceFreshness} = await import('../packages/cli/workspace-build.mjs');
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), () => launchManagedBrowser({channel: 'chrome'})), 0);
  const original = await readWorkspaceManifest(i.output);
  const index = await readFile(join(i.output, 'index.json'), 'utf8');
  const viewer = await serveViewer({
    config: {artifactPaths: ['/generated']},
    port: 0,
    output: i.output,
    publicPath: '/generated',
    workspaceStatus: bundle => annotateWorkspaceFreshness(bundle, i.directory)
  });
  t.after(() => viewer.close());
  const browser = await launchManagedBrowser({channel: 'chrome'});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await f.app.close();
  for (const report of ['{', JSON.stringify({reusedRevisions: {}})]) {
    await writeFile(join(i.output, 'latest-attempt.json'), report);
    const response = await fetch(viewer.url + 'generated/manifest.json');
    assert.equal(response.status, 200);
    const bundle = await response.json();
    assert.equal(bundle.generationId, original.generationId);
    assert.deepEqual(
      bundle.workspaces.map(w => [w.id, w.map.captureId, w.map.capturedAt, w.map.reused]),
      original.workspaces.map(w => [w.id, w.map.captureId, w.map.capturedAt, false])
    );
    const status = await fetch(viewer.url + '__atlas/workspaces');
    assert.equal(status.status, 200);
    assert.ok((await status.json()).workspaces.every(w => w.configurationChanged === false));
    await page.goto(viewer.url);
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.map-card img')];
      return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0);
    });
    assert.equal(
      await buildWorkspaces(i, selectProfiles(i.config), () => {
        throw Error('An unreadable report must not trigger recapture');
      }),
      0
    );
    assert.ok((await readWorkspaceManifest(i.output)).workspaces.every(w => w.map.reused));
    assert.equal(await readFile(join(i.output, 'index.json'), 'utf8'), index);
  }
  assert.deepEqual(errors, []);
});

test('Tag-dependent authentication invalidates only its account and refuses stale live sessions', async t => {
  const f = await fixture(t);
  const {parse, stringify} = await import('yaml');
  const {standardLiveSessions} = await import('../packages/cli/managed-workflow.mjs');
  await writeFile(
    join(f.directory, 'auth.mjs'),
    `export default {
    version: '1',
    async login({page, credentials, baseUrl}) {
      await page.goto(baseUrl);
      await page.locator('[name=username]').fill(credentials.username);
      await page.locator('[name=password]').fill(credentials.password);
      await page.getByRole('button', {name: '登录', exact: true}).click();
    },
    async verify({page, role}) {
      await page.locator('#identity').waitFor();
      return {authenticated: true, identityMatches: await page.locator('#identity').textContent() === role.tag + ' 身份'};
    }
  }`
  );
  const file = join(f.directory, 'atlas.yaml');
  const config = parse(await readFile(file, 'utf8'));
  config.authentication = {type: 'module', module: './auth.mjs'};
  for (const screen of config.screens) screen.ready = {text: '登录成功', exact: true};
  await writeFile(file, stringify(config));
  let i = await input(f),
    launches = 0;
  const launch = () => {
    launches++;
    return launchManagedBrowser({channel: 'chrome'});
  };
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  const before = await readWorkspaceManifest(i.output);
  const roles = (await f.store.load()).roles;
  const changed = roles[1];
  await f.store.saveRole(draft({...changed, tag: 'changed-tag', password: ''}));
  i = await input(f);
  const map = before.workspaces.find(w => w.id === changed.id).map;
  const live = await standardLiveSessions(i, selectProfiles(i.config)[0], () => {
    throw Error('Must reject before launching');
  });
  t.after(() => live.shutdown());
  await assert.rejects(
    live.open({screenId: map.screens[0].id, captureId: map.captureId, requestId: 'changed-tag'}),
    /配置或凭据已变化/
  );
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 1);
  assert.equal(launches, 3, 'unchanged first account must hit cache');
  assert.equal((await readWorkspaceManifest(i.output)).generationId, before.generationId);
  await f.store.saveRole(
    draft({...(await f.store.load()).roles.find(r => r.id === changed.id), tag: changed.tag, password: ''})
  );
  i = await input(f);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 3, 'restoring the original Tag recovers the successful cache');
});

test('success-report failure precedes publication and preserves the previous successful cache', async t => {
  const f = await fixture(t);
  const i = await input(f);
  const launch = () => launchManagedBrowser({channel: 'chrome'});
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  const before = await readFile(join(i.output, 'index.json'), 'utf8');
  const fs = await import('node:fs/promises');
  const {syncBuiltinESMExports} = await import('node:module');
  const original = fs.default.rename;
  let injected = false;
  fs.default.rename = async (from, to) => {
    if (to === join(i.output, 'latest-attempt.json') && !injected) {
      injected = true;
      throw Object.assign(Error('Injected report write failure'), {code: 'EIO'});
    }
    return original(from, to);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch, {force: true}), 1);
  } finally {
    fs.default.rename = original;
    syncBuiltinESMExports();
  }
  assert.ok(injected);
  assert.equal(await readFile(join(i.output, 'index.json'), 'utf8'), before);
  assert.equal(JSON.parse(await readFile(join(i.output, 'latest-attempt.json'), 'utf8')).status, 'failed');
  assert.equal(
    await buildWorkspaces(i, selectProfiles(i.config), () => {
      throw Error('Previous cache must remain reusable');
    }),
    0
  );
  assert.equal(await readFile(join(i.output, 'index.json'), 'utf8'), before);
});

test('commented URL-encoded authentication reexports invalidate cache and live snapshots when the helper changes', async t => {
  const f = await fixture(t);
  const {parse, stringify} = await import('yaml');
  const {standardLiveSessions} = await import('../packages/cli/managed-workflow.mjs');
  await writeFile(
    join(f.directory, 'auth.mjs'),
    "export {default} from /* identity adapter */ './helper%20%E8%BA%AB%E4%BB%BD%23.mjs';"
  );
  const helper = join(f.directory, 'helper 身份#.mjs');
  const source = `export default {version: '1',
    async login({page, credentials, baseUrl}) {
      await page.goto(baseUrl);
      await page.locator('[name=username]').fill(credentials.username);
      await page.locator('[name=password]').fill(credentials.password);
      await page.getByRole('button', {name: '登录', exact: true}).click();
    },
    async verify({page, role}) {
      await page.locator('#identity').waitFor();
      return {authenticated: true, identityMatches: await page.locator('#identity').textContent() === role.tag + ' 身份'};
    }
  }`;
  await writeFile(helper, source);
  const file = join(f.directory, 'atlas.yaml');
  const config = parse(await readFile(file, 'utf8'));
  config.authentication = {type: 'module', module: './auth.mjs'};
  await writeFile(file, stringify(config));
  const i = await input(f);
  let launches = 0;
  const launch = () => {
    launches++;
    return launchManagedBrowser({channel: 'chrome'});
  };
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  const before = await readWorkspaceManifest(i.output);
  await writeFile(helper, source.replace("version: '1'", "version: '2'"));
  const live = await standardLiveSessions(i, selectProfiles(i.config)[0], () => {
    throw Error('Must reject before browser launch');
  });
  t.after(() => live.shutdown());
  await assert.rejects(
    live.open({screenId: before.screens[0].id, captureId: before.captureId, requestId: 'helper-change'}),
    /配置或凭据已变化/
  );
  // The long-lived process must reject the changed Node module graph rather than use cached imports.
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 1);
  assert.equal(launches, 3);
  assert.equal((await readWorkspaceManifest(i.output)).generationId, before.generationId);
  await writeFile(helper, source);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  assert.equal(launches, 3);
});

test('source changes after the index temporary file is written cannot publish a stale generation', async t => {
  const f = await fixture(t);
  const i = await input(f);
  const launch = () => launchManagedBrowser({channel: 'chrome'});
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  const before = await readFile(join(i.output, 'index.json'), 'utf8');
  const source = join(f.root, 'lib/during-publication.dart');
  const fs = await import('node:fs/promises');
  const {syncBuiltinESMExports} = await import('node:module');
  const original = fs.default.writeFile;
  let injected = false;
  fs.default.writeFile = async (file, ...args) => {
    await original(file, ...args);
    if (
      !injected &&
      typeof file === 'string' &&
      file.startsWith(join(i.output, 'index.json.')) &&
      file.endsWith('.tmp')
    ) {
      injected = true;
      await original(source, '// new source during publication');
    }
  };
  syncBuiltinESMExports();
  try {
    assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch, {force: true}), 1);
  } finally {
    fs.default.writeFile = original;
    syncBuiltinESMExports();
  }
  assert.ok(injected);
  assert.equal(await readFile(join(i.output, 'index.json'), 'utf8'), before);
  assert.match(
    JSON.parse(await readFile(join(i.output, 'latest-attempt.json'), 'utf8')).error,
    /Source changed during publication/
  );
  await fs.rm(source);
  assert.equal(
    await buildWorkspaces(i, selectProfiles(i.config), () => {
      throw Error('Old cache must survive');
    }),
    0
  );
});

test('corrupt or malformed cache metadata is a miss, including force, and the rebuilt cache is reusable', async t => {
  const f = await fixture(t);
  const i = await input(f);
  let launches = 0;
  const launch = () => {
    launches++;
    return launchManagedBrowser({channel: 'chrome'});
  };
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch), 0);
  for (const [contents, force] of [
    ['{truncated', true],
    ['{"records":[]}', false]
  ]) {
    const before = await readWorkspaceManifest(i.output);
    await writeFile(join(f.directory, 'build-state', before.generationId + '.json'), contents);
    const count = launches;
    assert.equal(await buildWorkspaces(i, selectProfiles(i.config), launch, {force}), 0);
    assert.equal(launches, count + 2);
    const fresh = await readWorkspaceManifest(i.output);
    assert.notEqual(fresh.generationId, before.generationId);
    assert.equal(
      await buildWorkspaces(i, selectProfiles(i.config), () => {
        throw Error('Recovered cache must hit');
      }),
      0
    );
    assert.equal((await readWorkspaceManifest(i.output)).captureId, fresh.captureId);
  }
});

for (const loader of ['createRequire', 'indirect-commonjs'])
  test(`${loader} aliases disable CLI cache hits and stale live sessions across real browser captures`, async t => {
    const f = await standardFixture({roles: ['reader', 'admin']});
    t.after(() => f.cleanup());
    const {parse, stringify} = await import('yaml');
    const {standardLiveSessions} = await import('../packages/cli/managed-workflow.mjs');
    const {execFile} = await import('node:child_process');
    const {promisify} = await import('node:util');
    const {fileURLToPath} = await import('node:url');
    await writeFile(join(f.directory, 'identity.cjs'), 'module.exports = {allow: true};');
    await writeFile(join(f.directory, 'bridge.cjs'), "const load = require; module.exports = load('./identity.cjs');");
    const loaderSource =
      loader === 'createRequire'
        ? "import {createRequire as makeLoader} from 'node:module'; const load = makeLoader(import.meta.url); const policy = load('./identity.cjs');"
        : "import policy from './bridge.cjs';";
    await writeFile(
      join(f.directory, 'auth.mjs'),
      `
    ${loaderSource}
    export default {version: '1',
      async login({page, credentials, baseUrl}) {
        await page.goto(baseUrl);
        await page.locator('[name=username]').fill(credentials.username);
        await page.locator('[name=password]').fill(credentials.password);
        await page.getByRole('button', {name: '登录', exact: true}).click();
      },
      async verify({page, role}) {
        await page.locator('#identity').waitFor();
        return {authenticated: true, identityMatches: policy.allow && await page.locator('#identity').textContent() === role.tag + ' 身份'};
      }
    }
  `
    );
    const file = join(f.directory, 'atlas.yaml');
    const config = parse(await readFile(file, 'utf8'));
    config.authentication = {type: 'module', module: './auth.mjs'};
    await writeFile(file, stringify(config));
    const cli = fileURLToPath(new URL('../packages/cli/atlas.mjs', import.meta.url));
    const build = async () => {
      try {
        const {stdout} = await promisify(execFile)(process.execPath, [cli, 'build'], {cwd: f.root});
        return {code: 0, output: stdout};
      } catch (error) {
        return {code: error.code, output: error.stdout + error.stderr};
      }
    };
    const first = await build();
    assert.equal(first.code, 0, first.output);
    assert.match(first.output, /"cacheable":false/);
    const i = await input(f);
    const before = await readWorkspaceManifest(i.output);
    const second = await build();
    assert.equal(second.code, 0, second.output);
    const fresh = await readWorkspaceManifest(i.output);
    assert.notEqual(fresh.captureId, before.captureId, 'unchanged inputs must not reuse an untracked module graph');
    const live = await standardLiveSessions(i, selectProfiles(i.config)[0], () => {
      throw Error('Must reject before browser launch');
    });
    t.after(() => live.shutdown());
    await assert.rejects(
      live.open({screenId: fresh.screens[0].id, captureId: fresh.captureId, requestId: 'dynamic-loader'}),
      /freshness cannot be verified/
    );
    await writeFile(join(f.directory, 'identity.cjs'), 'module.exports = {allow: false};');
    const third = await build();
    assert.equal(third.code, 1, third.output);
    assert.equal((await readWorkspaceManifest(i.output)).generationId, fresh.generationId);
  });

test('same-origin login redirect permits authenticated workspace capture', async t => {
  const f = await fixture(t);
  f.app.controls.redirectSignedOut = true;
  const i = await input(f);
  assert.equal(await buildWorkspaces(i, selectProfiles(i.config), () => launchManagedBrowser({channel: 'chrome'})), 0);
  const map = await readWorkspaceManifest(i.output);
  assert.equal(map.workspaces.length, 2);
  for (const workspace of map.workspaces) {
    assert.ok(workspace.map.screens.every(screen => screen.status === 'captured'));
    assert.ok(workspace.map.edges.every(edge => edge.status === 'observed'));
  }
});
