import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, symlink, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fingerprintSources, canonical, workspaceCatalog} from '../packages/cli/build-input.mjs';
import {ensureApplicationIdentity} from '../packages/cli/application-identity.mjs';

test('no-Git content fingerprint covers new, dirty, removed source and font files', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-input-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, '.atlas'));
  await mkdir(join(root, 'lib'));
  await mkdir(join(root, 'assets'));
  await writeFile(
    join(root, 'pubspec.yaml'),
    'name: example\nflutter:\n  fonts:\n    - family: Test\n      fonts:\n        - asset: assets/font.ttf\n'
  );
  await writeFile(join(root, 'assets/font.ttf'), 'font');
  const read = () => fingerprintSources({}, join(root, '.atlas'));
  const first = await read();
  assert.ok(first.reusable);
  assert.ok(first.files.includes('assets/font.ttf'));
  await writeFile(join(root, 'lib/untracked.dart'), 'one');
  const next = await read();
  assert.notEqual(next.digest, first.digest);
  await writeFile(join(root, 'lib/untracked.dart'), 'two');
  assert.notEqual((await read()).digest, next.digest);
  await rm(join(root, 'lib/untracked.dart'));
  assert.equal((await read()).digest, first.digest);
  await symlink('/tmp', join(root, 'lib/link'));
  assert.equal((await read()).reusable, false);
  const id = await ensureApplicationIdentity(join(root, '.atlas'));
  assert.equal(await ensureApplicationIdentity(join(root, '.atlas')), id);
  await assert.rejects(fingerprintSources({sourceFiles: ['.']}, join(root, '.atlas')), /excluded/);
});
test('canonical semantic input ignores object order and public closure never enters another account', () => {
  assert.equal(canonical({a: 1, b: 2}), canonical({b: 2, a: 1}));
  const catalog = {
    screens: [
      {id: 'a', accountId: 'a'},
      {id: 'b', accountId: 'b'},
      {id: 'login', accountId: '@anonymous'},
      {id: 'help', accountId: '@anonymous'}
    ],
    edges: [
      {source: 'login', target: 'a'},
      {source: 'login', target: 'b'},
      {source: 'login', target: 'help'}
    ]
  };
  const map = workspaceCatalog(catalog, 'a');
  assert.deepEqual(
    map.screens.map(s => s.id),
    ['a', 'login', 'help']
  );
  assert.equal(map.edges.length, 2);
});

test('authentication module dependencies participate in source identity and dynamic imports disable reuse', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-auth-input-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const directory = join(root, '.atlas');
  await mkdir(directory);
  await writeFile(join(root, 'pubspec.yaml'), 'name: test\n');
  await writeFile(join(directory, 'auth.mjs'), "import {version} from './helper.mjs'; export default {version};");
  await writeFile(join(directory, 'helper.mjs'), "export const version='one';");
  const config = {authentication: {type: 'module', module: './auth.mjs'}};
  const first = await fingerprintSources(config, directory);
  assert.equal(first.reusable, true);
  await writeFile(join(directory, 'helper.mjs'), "export const version='two';");
  assert.notEqual((await fingerprintSources(config, directory)).digest, first.digest);
  await writeFile(join(directory, 'auth.mjs'), "const path='./helper.mjs'; export default await import(path);");
  assert.equal((await fingerprintSources(config, directory)).reusable, false);
});

test('initialization privacy rules still work when Git is not installed', async t => {
  const {ensureAtlasIgnored} = await import('../packages/cli/project-ignore.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-no-git-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const original = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-atlas-tools';
    await ensureAtlasIgnored(root);
  } finally {
    process.env.PATH = original;
  }
  const {readFile} = await import('node:fs/promises');
  assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), '/.atlas/\n');
});

test('capture identity includes account Tag and resource prefix but excludes display-name-only changes', async () => {
  const {captureInputs} = await import('../packages/cli/build-input.mjs');
  const snapshot = {config: {}, project: {baseUrl: 'http://localhost', authentication: {type: 'module'}}};
  const role = {id: 'account', tag: 'reader', name: 'Reader', credentials: {username: 'u', password: 'p'}};
  const key = (r = role, config = {}) =>
    canonical(
      captureInputs(
        {...snapshot, config},
        {
          screens: [{id: 'account:page', accountId: 'account', role: r.name, _role: r}],
          edges: []
        },
        {viewport: {width: 393, height: 852}},
        {digest: 'source'}
      )
    );
  assert.equal(key(), key({...role, name: 'Renamed'}));
  assert.equal(key(), key(role, {publicPath: '/generated'}));
  assert.notEqual(key(), key({...role, tag: 'admin'}));
  assert.notEqual(key(), key(role, {publicPath: '/renamed'}));
});

test('ESM dependency parsing handles comments, reexports, escaped specifiers and literal dynamic imports', async t => {
  const {fingerprintModule} = await import('../packages/cli/build-input.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-module-syntax-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = join(root, 'auth.mjs');
  await writeFile(
    entry,
    String.raw`
    import /* comment */ './side.mjs';
    export {value} from /* comment */ './helper.mjs';
    const load = () => import /* comment */ ('./literal.mjs');
    import {other} from './esc\u0061ped.mjs';
    const text = "import './nonexistent.mjs'";
    // export * from './also-nonexistent.mjs';
  `
  );
  const dependencies = ['side.mjs', 'helper.mjs', 'literal.mjs', 'escaped.mjs'];
  for (const file of dependencies) await writeFile(join(root, file), 'export const value = 1, other = 1;');
  let previous = await fingerprintModule(entry);
  assert.equal(previous.complete, true);
  for (const file of dependencies) {
    await writeFile(join(root, file), 'export const value = 2, other = 2;');
    const next = await fingerprintModule(entry);
    assert.equal(next.complete, true);
    assert.notEqual(next.digest, previous.digest, file);
    previous = next;
  }
  for (const source of [
    "const target='./helper.mjs'; import /* comment */ (target);",
    "const require = () => {}; require /* comment */ ('./helper.mjs');",
    'import {'
  ]) {
    await writeFile(entry, source);
    assert.equal((await fingerprintModule(entry)).complete, false, source);
  }
});

test('Node module loader imports disable reuse regardless of createRequire aliases', async t => {
  const {fingerprintModule} = await import('../packages/cli/build-input.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-module-loader-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = join(root, 'auth.mjs');
  await writeFile(join(root, 'helper.cjs'), 'module.exports = 1;');
  for (const source of [
    "import {createRequire as makeLoader} from 'node:module'; const load = makeLoader(import.meta.url); export default load('./helper.cjs');",
    "import * as modules from 'node:module'; const load = modules.createRequire(import.meta.url); export default load('./helper.cjs');",
    "const {createRequire: makeLoader} = await import('node:module'); export default makeLoader(import.meta.url)('./helper.cjs');",
    "export {default} from './bridge.mjs';"
  ]) {
    await writeFile(join(root, 'bridge.mjs'), "import modules from 'node:module'; export default modules;");
    await writeFile(entry, source);
    const graph = await fingerprintModule(entry);
    assert.equal(graph.complete, false);
    assert.ok(graph.reasons.some(reason => reason.includes('module loaders')));
  }
});

test('relative ESM imports use Node file URL decoding for dependency identity', async t => {
  const {fingerprintModule} = await import('../packages/cli/build-input.mjs');
  const {pathToFileURL} = await import('node:url');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-module-url-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = join(root, 'auth.mjs');
  const name = 'helper 空格#?%.mjs';
  const helper = join(root, name);
  await writeFile(helper, 'export default 1;');
  await writeFile(entry, `export {default} from './${encodeURIComponent(name)}';`);
  assert.equal((await import(pathToFileURL(entry).href)).default, 1);
  const before = await fingerprintModule(entry);
  assert.equal(before.complete, true);
  await writeFile(helper, 'export default 2;');
  const after = await fingerprintModule(entry);
  assert.equal(after.complete, true);
  assert.notEqual(after.digest, before.digest);
  // Literal query and fragment suffixes are still unsupported, unlike encoded filename characters.
  for (const suffix of ['?version=1', '#fragment']) {
    await writeFile(entry, `export {default} from './${encodeURIComponent(name)}${suffix}';`);
    assert.equal((await fingerprintModule(entry)).complete, false);
  }
});

test('indirect CommonJS require aliases and ambiguous .js helpers are never a complete ESM graph', async t => {
  const {fingerprintModule} = await import('../packages/cli/build-input.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-indirect-cjs-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = join(root, 'auth.mjs');
  for (const extension of ['cjs', 'js']) {
    await writeFile(entry, `export {default} from './bridge.${extension}';`);
    await writeFile(join(root, `bridge.${extension}`), "const load = require; module.exports = load('./policy.cjs');");
    await writeFile(join(root, 'policy.cjs'), 'module.exports = {allow: true};');
    const before = await fingerprintModule(entry);
    await writeFile(join(root, 'policy.cjs'), 'module.exports = {allow: false};');
    const after = await fingerprintModule(entry);
    assert.equal(before.complete, false);
    assert.equal(after.complete, false);
    assert.ok(after.reasons.some(reason => reason.includes('.mjs')));
  }
});

test('parent-directory symlinks and swapped resolution targets invalidate graph identity', async t => {
  const {fingerprintModule} = await import('../packages/cli/build-input.mjs');
  const {unlink} = await import('node:fs/promises');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-resolution-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const directory of ['one', 'two']) {
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, 'helper.mjs'), 'export default 1;');
  }
  await symlink(join(root, 'one'), join(root, 'left'));
  await symlink(join(root, 'two'), join(root, 'right'));
  const entry = join(root, 'auth.mjs');
  await writeFile(
    entry,
    "import a from './left/helper.mjs'; import b from './right/helper.mjs'; export default [a,b];"
  );
  const before = await fingerprintModule(entry);
  const entryBefore = await fingerprintModule(join(root, 'left/helper.mjs'));
  assert.equal(entryBefore.complete, false);
  assert.equal(before.complete, false);
  assert.ok(before.reasons.some(reason => reason.includes('Symbolic')));
  await unlink(join(root, 'left'));
  await unlink(join(root, 'right'));
  await symlink(join(root, 'two'), join(root, 'left'));
  await symlink(join(root, 'one'), join(root, 'right'));
  const after = await fingerprintModule(entry);
  assert.deepEqual(
    [...after.files].sort((a, b) => a.path.localeCompare(b.path)),
    [...before.files].sort((a, b) => a.path.localeCompare(b.path))
  );
  assert.notEqual(after.digest, before.digest, 'the same files and bytes do not imply the same dependency resolution');
  assert.notDeepEqual(after.resolutions, before.resolutions);
  assert.notEqual((await fingerprintModule(join(root, 'left/helper.mjs'))).digest, entryBefore.digest);
});
