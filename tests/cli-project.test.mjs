import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {resolveProjectConfig} from '../packages/cli/project.mjs';

const cli = fileURLToPath(new URL('../packages/cli/atlas.mjs', import.meta.url));
const atlas = (cwd, ...args) => promisify(execFile)(process.execPath, [cli, ...args], {cwd});

async function fixture(t) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'atlas-project-')));
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const app = join(workspace, 'app');
  const cwd = join(app, 'lib');
  const tools = join(workspace, 'tools/app-atlas');
  await mkdir(cwd, {recursive: true});
  await mkdir(tools, {recursive: true});
  await promisify(execFile)('git', ['init', '--quiet', workspace]);
  await writeFile(join(app, 'pubspec.yaml'), 'name: example\ndependencies: {flutter: {sdk: flutter}}\n');
  return {workspace, app, cwd, tools};
}

test('从 Flutter 子目录找到工具配置，只应用指向当前工程的配置', async t => {
  const {workspace, app, cwd, tools} = await fixture(t);
  const other = join(workspace, 'other');
  await mkdir(other);
  const config = join(tools, 'atlas.config.mjs');
  await writeFile(config, "export default {flutterProject:'../../other'}");
  const implicit = await resolveProjectConfig({cwd});
  assert.equal(implicit.directory, join(app, '.atlas'));
  assert.equal(implicit.config.output, 'generated');

  await writeFile(join(tools, 'atlas.config.json'), '{"flutterProject":"../../app","title":"项目地图"}');
  await assert.rejects(resolveProjectConfig({cwd}), /同时有两种/);
  await rm(config);
  const selected = await resolveProjectConfig({cwd});
  assert.equal(selected.directory, tools);
  assert.equal(selected.config.title, '项目地图');
});

test('init 在 Flutter 根生成模板和说明，重复执行不覆盖', async t => {
  const {app, cwd} = await fixture(t);
  await assert.rejects(atlas(app, 'init', '--yes', '--port', '70000'), /有效的 TCP 端口/);
  await atlas(
    cwd,
    'init',
    '--yes',
    '--name',
    '演示应用',
    '--port',
    '60600',
    '--url',
    'http://127.0.0.1:60601/',
    '--ready-text',
    '首页'
  );
  const directory = join(app, '.atlas');
  const configFile = join(directory, 'atlas.yaml');
  const before = await readFile(configFile, 'utf8');
  await assert.rejects(atlas(app, 'init', '--yes', '--name', '不能覆盖'), /已初始化/);
  assert.equal(await readFile(configFile, 'utf8'), before);
  assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /atlas build/);
  assert.equal(await readFile(join(directory, '.gitignore'), 'utf8'), '/generated/\n');
  assert.equal(await readFile(join(app, '.gitignore'), 'utf8'), '/.atlas/\n');
  await promisify(execFile)('git', ['-C', app, 'check-ignore', '.atlas/atlas.yaml', '.atlas/credentials.json']);
  assert.doesNotMatch(await readFile(join(directory, 'README.md'), 'utf8'), /^- 提交配置/m);
  const selected = await resolveProjectConfig({cwd});
  assert.equal(selected.entryMode, true);
  assert.deepEqual(selected.config, {
    title: '演示应用',
    port: 60600,
    output: 'generated',
    baseUrl: 'http://127.0.0.1:60601/',
    readyText: '首页'
  });
  await assert.rejects(atlas(app, 'record'), /录制需要 discovery/);
});

test('init 显式接入旧适配器，YAML 优先，旧配置仍可单独调用', async t => {
  const {app, cwd, tools} = await fixture(t);
  const config = join(tools, 'atlas.config.mjs');
  await writeFile(
    config,
    `export default {
    flutterProject: '../../app', output: '../old', port: 60000,
    discovery: {candidates: () => [], open: () => null}
  }`
  );
  await atlas(app, 'init', '--yes', '--adapter-config', config, '--port', '60322');
  const selected = await resolveProjectConfig({cwd});
  assert.equal(selected.custom, true);
  assert.equal(typeof selected.config.discovery.candidates, 'function');
  assert.equal(selected.config.output, 'generated');
  assert.equal(selected.config.port, 60322);
  const legacy = await resolveProjectConfig({cwd, configFile: config});
  assert.equal(legacy.config.output, '../old');
  assert.equal(legacy.config.port, 60000);
});

test('init 自动接入当前工程的旧适配器并沿用已有 .atlas 子目录', async t => {
  const {app, cwd, tools} = await fixture(t);
  await writeFile(
    join(tools, 'atlas.config.mjs'),
    `export default {
    flutterProject: '../../app', output: '../../app/.atlas/discovery', port: 60323,
    viewer: {shell: {title: '已有应用'}}, discovery: {candidates: () => [], open: () => null}
  }`
  );
  const {stdout} = await atlas(app, 'init', '--yes');
  assert.match(stdout, /沿用现有 Atlas 适配器/);
  const selected = await resolveProjectConfig({cwd});
  assert.equal(selected.config.title, '已有应用');
  assert.equal(selected.config.port, 60323);
  assert.equal(selected.config.output, 'discovery');
  assert.match(await readFile(join(app, '.atlas', '.gitignore'), 'utf8'), /^\/discovery\/$/m);
});

test('工程配置不允许把产物写到 .atlas 外或通过符号链接跳转', async t => {
  const {app} = await fixture(t);
  const directory = join(app, '.atlas');
  await mkdir(directory);
  const yaml = join(directory, 'atlas.yaml');
  await writeFile(yaml, 'output: ../outside\n');
  await assert.rejects(atlas(app, 'build'), /\.atlas 内的子目录/);
  await writeFile(yaml, 'output: generated\n');
  await symlink(app, join(directory, 'generated'), 'dir');
  await assert.rejects(atlas(app, 'view'), /必须是实际目录/);
});

test('显式配置覆盖同级歧义，工程配置优先于工具目录', async t => {
  const {workspace, app, cwd, tools} = await fixture(t);
  await writeFile(join(tools, 'atlas.config.json'), '{"flutterProject":"../../app","title":"工具配置"}');
  await writeFile(join(app, 'atlas.config.json'), '{"title":"工程配置"}');
  assert.equal((await resolveProjectConfig({cwd})).config.title, '工程配置');
  await writeFile(join(app, 'atlas.config.mjs'), 'export default {title:"脚本配置"}');
  await assert.rejects(resolveProjectConfig({cwd}), /--config/);
  const selected = await resolveProjectConfig({cwd: workspace, configFile: 'app/atlas.config.mjs'});
  assert.equal(selected.config.title, '脚本配置');
});

test('init 拒绝根忽略文件符号链接且不生成本机配置', async t => {
  const {app, workspace} = await fixture(t);
  const external = join(workspace, 'external-ignore');
  await writeFile(external, '# 用户规则\n');
  await symlink(external, join(app, '.gitignore'));
  await assert.rejects(atlas(app, 'init', '--yes'), /符号链接/);
  assert.equal(await readFile(external, 'utf8'), '# 用户规则\n');
  await assert.rejects(readFile(join(app, '.atlas', 'atlas.yaml')), {code: 'ENOENT'});
});

test('init 拒绝已被跟踪的本机文件且不修改索引或用户配置', async t => {
  const {app} = await fixture(t);
  await mkdir(join(app, '.atlas'));
  const local = join(app, '.atlas', 'credentials.json');
  await writeFile(local, '{}\n');
  const git = (...args) => promisify(execFile)('git', ['-C', app, ...args]);
  await git('add', '.atlas/credentials.json');
  const before = (await git('ls-files', '--stage')).stdout;
  await assert.rejects(atlas(app, 'init', '--yes'), /已被 Git 跟踪.*取消跟踪/s);
  assert.equal((await git('ls-files', '--stage')).stdout, before);
  assert.equal(await readFile(local, 'utf8'), '{}\n');
  await assert.rejects(readFile(join(app, '.atlas', 'atlas.yaml')), {code: 'ENOENT'});
});

test('重复 init 遇到已跟踪旧 YAML 时明确拒绝且保留配置', async t => {
  const {app} = await fixture(t);
  await mkdir(join(app, '.atlas'));
  const config = join(app, '.atlas', 'atlas.yaml');
  const original = 'title: 用户配置\noutput: generated\n';
  await writeFile(config, original);
  await promisify(execFile)('git', ['-C', app, 'add', '.atlas/atlas.yaml']);
  await assert.rejects(atlas(app, 'init', '--yes'), /已被 Git 跟踪.*取消跟踪/s);
  assert.equal(await readFile(config, 'utf8'), original);
});

test('init 后续失败回滚保留用户新写内容和根忽略规则', async t => {
  const {app} = await fixture(t);
  const config = join(app, '.atlas', 'atlas.yaml');
  const ignore = join(app, '.gitignore');
  await writeFile(ignore, '# 原有规则\n');
  const initModule = new URL('../packages/cli/init.mjs', import.meta.url).href;
  const script = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    const original = fs.promises.open;
    fs.promises.open = async function(file, ...args) {
      if (String(file).endsWith('/.atlas/README.md')) {
        await fs.promises.writeFile(${JSON.stringify(config)}, 'title: 用户新内容\\n');
        await fs.promises.appendFile(${JSON.stringify(ignore)}, '# 用户追加规则\\n');
        throw Error('模拟说明文件创建失败');
      }
      return original.call(this, file, ...args);
    };
    syncBuiltinESMExports();
    const {initAtlas} = await import(${JSON.stringify(initModule)});
    await initAtlas({yes: true}, {cwd: ${JSON.stringify(app)}});
  `;
  await assert.rejects(
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]),
    /模拟说明文件创建失败/
  );
  assert.equal(await readFile(config, 'utf8'), 'title: 用户新内容\n');
  assert.equal(await readFile(ignore, 'utf8'), '# 原有规则\n/.atlas/\n# 用户追加规则\n');
});
