import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {access, cp, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {delimiter, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {parse, stringify} from 'yaml';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const fixture = new URL('./shop-catalog.yaml', import.meta.url);
let installed;
let isolatedEnvironment;
const baselines = new Map();
const execute = promisify(execFile);

export async function snapshotShopSources(directory) {
  const files = {};
  async function visit(relative) {
    const path = join(directory, relative);
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(relative + '/' + name);
    } else
      files[relative] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
  }
  for (const name of ['lib', 'web', 'test', 'assets', 'pubspec.yaml', 'pubspec.lock', 'README.md']) await visit(name);
  return files;
}

export async function assertShopSourcesUnchanged(directory) {
  const baseline = baselines.get(directory);
  assert(baseline, '只能检查由普通 Demo 建立的独立接入工程');
  const actual = await snapshotShopSources(directory);
  assert.deepEqual(actual, baseline.files, '接入、配置、构建与查看均不得改动普通应用源码或入口');
  const newline = baseline.ignore.includes('\r\n') ? '\r\n' : '\n';
  const expected = baseline.ignore.split(/\r?\n/).includes('/.atlas/')
    ? baseline.ignore
    : baseline.ignore + (baseline.ignore && !baseline.ignore.endsWith('\n') ? newline : '') + '/.atlas/' + newline;
  assert.equal(
    await readFile(join(directory, '.gitignore'), 'utf8'),
    expected,
    '.gitignore 只能在原内容后追加 Atlas 本机目录规则'
  );
  await assert.rejects(access(join(directory, '.git/index')), {code: 'ENOENT'}, '工具不能自动添加文件或创建索引');
  return {
    sourceFiles: Object.keys(actual).length,
    sourceSha256: createHash('sha256').update(JSON.stringify(actual)).digest('hex'),
    entrySha256: actual['lib/main.dart'],
    unchanged: true
  };
}

export async function assertShopIgnored(directory, paths) {
  const {stdout} = await execute('git', ['check-ignore', '--no-index', '--', ...paths], {
    cwd: directory,
    env: await shopCliEnvironment()
  });
  assert.deepEqual(stdout.trim().split(/\r?\n/).sort(), [...paths].sort(), '本机配置、凭据和产物必须实际被 Git 忽略');
}

/** CLI 阶段仅暴露必需的系统工具；Flutter 不只是未使用，而是确实不在 PATH。 */
export function shopCliEnvironment() {
  return (isolatedEnvironment ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-cli-tools-'));
    let npm;
    for (const part of process.env.PATH.split(delimiter)) {
      const candidate = join(part, 'npm');
      try {
        await access(candidate);
        npm = candidate;
        break;
      } catch {}
    }
    assert(npm, '需要已安装的 npm 来验证真实安装包');
    for (const [name, target] of Object.entries({node: process.execPath, npm, git: '/usr/bin/git', sh: '/bin/sh'})) {
      await symlink(target, join(directory, name));
    }
    const env = {...process.env, PATH: directory, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'};
    const check = spawn('/bin/sh', ['-c', 'command -v flutter'], {env, stdio: 'ignore'});
    const [code] = await once(check, 'exit');
    assert.equal(code, 1, 'CLI 验收环境必须找不到 flutter');
    return env;
  })());
}

export async function runShopCli(cli, cwd, args, {timeout = 300000} = {}) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: await shopCliEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => {
    output += data;
  });
  child.stderr.on('data', data => {
    output += data;
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);
  return {code, signal, output};
}

/** 真正安装 tarball；验收期间从临时 node_modules 执行公开 CLI。 */
export function installShopCli() {
  if (process.env.SHOP_ATLAS_CLI) return Promise.resolve(resolve(process.env.SHOP_ATLAS_CLI));
  return (installed ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-atlas-installed-'));
    const packed = await runShopCli(join(repository, 'scripts/pack-cli.mjs'), repository, [
      join(directory, 'packages')
    ]);
    assert.equal(packed.code, 0, packed.output);
    const tarball = (await readdir(join(directory, 'packages'))).find(name => name.endsWith('.tgz'));
    assert(tarball, '安装验收需要真实 npm tarball');
    await writeFile(join(directory, 'package.json'), '{"private":true}');
    const child = spawn(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, 'packages', tarball)],
      {
        cwd: directory,
        env: await shopCliEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    let output = '';
    child.stdout.on('data', data => {
      output += data;
    });
    child.stderr.on('data', data => {
      output += data;
    });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, output);
    const cli = join(directory, 'node_modules/flutter-ui-atlas/packages/cli/atlas.mjs');
    assert((await realpath(cli)).startsWith(await realpath(directory)), '必须运行临时工程内安装的 CLI');
    return cli;
  })());
}

export async function availableShopPort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

export async function startShopCli(cli, cwd, args) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: await shopCliEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let stopped;
  const close = () =>
    (stopped ??= (async () => {
      if (child.exitCode !== null) return;
      const exit = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      await exit;
      clearTimeout(timer);
    })());
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(() => {
      void close();
      reject(Error(`CLI 服务启动超时：${output}`));
    }, 20000);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(Error(`CLI 服务退出 ${code}：${output}`));
    });
    child.stderr.on('data', data => {
      output += data;
    });
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/(?:#token=[\w-]+)?/);
      if (match) {
        clearTimeout(timer);
        done(match[0]);
      }
    });
  });
  return {url, close};
}

export async function createShopProject(cli, baseUrl) {
  const directory = await mkdtemp(join(tmpdir(), 'shop-standard-project-'));
  const source = resolve(process.env.SHOP_DEMO_PROJECT ?? join(repository, 'demo'));
  await cp(source, directory, {
    recursive: true,
    filter: path =>
      !['.git', '.atlas', '.dart_tool', 'build', '.flutter-plugins-dependencies'].includes(path.split('/').at(-1))
  });
  baselines.set(directory, {
    files: await snapshotShopSources(directory),
    ignore: await readFile(join(directory, '.gitignore'), 'utf8')
  });
  await execute('git', ['init', '--quiet'], {cwd: directory, env: await shopCliEnvironment()});
  const result = await runShopCli(cli, directory, ['init', '--yes', '--url', baseUrl, '--ready-text', '登录拾物']);
  assert.equal(result.code, 0, result.output);
  await assertShopSourcesUnchanged(directory);
  await assertShopIgnored(directory, [
    '.atlas/atlas.yaml',
    '.atlas/local/credentials.json',
    '.atlas/generated/phone/manifest.json',
    '.atlas/generated/phone/capture/0.png',
    '.atlas/local/sessions/check.json'
  ]);
  const config = parse(await readFile(fixture, 'utf8'));
  config.baseUrl = baseUrl;
  config.port = await availableShopPort();
  await writeFile(join(directory, '.atlas/atlas.yaml'), stringify(config));
  return directory;
}

/** 全程通过配置页真实录入，凭据不经 YAML fixture、内部 API 或环境变量注入。 */
export async function configureShopAccounts(page, baseUrl, {includeFailure = false} = {}) {
  await page.getByRole('button', {name: '应用设置', exact: true}).click();
  await page.getByLabel('Flutter Web 地址', {exact: true}).fill(baseUrl);
  await page.getByLabel('认证方式', {exact: true}).selectOption('form');
  await page.getByLabel('登录地址', {exact: true}).fill(baseUrl);
  await page.getByLabel('账号字段', {exact: true}).fill('登录账号');
  await page.getByLabel('密码字段', {exact: true}).fill('登录密码');
  await page.getByLabel('提交按钮', {exact: true}).fill('登录');
  await page.getByLabel('成功判据定位方式', {exact: true}).selectOption('role');
  await page.getByLabel('成功判据语义角色', {exact: true}).fill('heading');
  await page.getByLabel('成功判据', {exact: true}).fill('首页');
  await page.getByLabel('失败判据（可选）', {exact: true}).fill('账号或密码错误');
  await page.getByRole('button', {name: '保存设置', exact: true}).click();
  await page.getByRole('complementary').waitFor({state: 'hidden'});
  for (const account of [
    {tag: 'user1', name: '商城用户一', username: 'user1', password: '1234.com', passed: true},
    {tag: 'user2', name: '商城用户二', username: 'user2', password: '1234.com', passed: true},
    ...(includeFailure ? [{tag: 'wrong', name: '失败示例', username: 'user1', password: 'wrong', passed: false}] : [])
  ]) {
    await page.getByRole('button', {name: '新增角色', exact: true}).first().click();
    await page.getByLabel('Tag', {exact: true}).fill(account.tag);
    await page.getByLabel('显示名称', {exact: true}).fill(account.name);
    await page.getByLabel('登录账号', {exact: true}).fill(account.username);
    await page.getByLabel('登录密码', {exact: true}).fill(account.password);
    await page.getByRole('button', {name: '测试登录', exact: true}).click();
    await page
      .getByRole('status')
      .filter({hasText: account.passed ? /^测试通过$/ : /^测试未通过$/})
      .waitFor();
    await page.getByRole('button', {name: '保存角色', exact: true}).click();
    await page.getByRole('button', {name: `编辑${account.name}`, exact: true}).waitFor();
  }
}

export async function assertShopPrivateFiles(directory) {
  const yaml = await readFile(join(directory, '.atlas/atlas.yaml'), 'utf8');
  assert(!yaml.includes('1234.com'));
  assert(!yaml.includes('unit-test-only'));
  assert.equal((await stat(join(directory, '.atlas/local'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, '.atlas/local/credentials.json'))).mode & 0o777, 0o600);
  return parse(yaml);
}

export async function readShopLiveRecord(directory, captureId) {
  const records = [];
  for (const name of await readdir(join(directory, '.atlas/local/sessions'))) {
    if (!name.endsWith('.json')) continue;
    const file = join(directory, '.atlas/local/sessions', name);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record.captureId === captureId) records.push(record);
  }
  assert.equal(records.length, 1, '当前独立 Viewer 应恰好拥有一个对应采集的实时会话');
  return records[0];
}
