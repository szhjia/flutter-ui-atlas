import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {ensureAtlasIgnored} from '../packages/cli/project-ignore.mjs';

const exec = promisify(execFile);
async function fixture(t, git = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-ignore-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  if (git) await exec('git', ['init', '--quiet', root]);
  return root;
}
const git = (root, ...args) => exec('git', ['-C', root, ...args]);

test('忽略整个本机目录，真实 Git 验证且重复调用不改文件', async t => {
  const root = await fixture(t);
  await ensureAtlasIgnored(root);
  const file = join(root, '.gitignore');
  assert.equal(await readFile(file, 'utf8'), '/.atlas/\n');
  const before = await lstat(file);
  await ensureAtlasIgnored(root);
  assert.equal((await lstat(file)).ino, before.ino);
  await mkdir(join(root, '.atlas'));
  for (const path of ['atlas.yaml', 'credentials.json', 'config-draft.json', 'generated/report.json']) {
    await git(root, 'check-ignore', `.atlas/${path}`);
  }
});

for (const original of ['# 用户规则\n/build/\n', '# 用户规则\r\n/build/\r\n', '# 用户规则\n/build/', '']) {
  test(`原样保留已有内容并原子替换：${JSON.stringify(original)}`, async t => {
    const root = await fixture(t);
    const file = join(root, '.gitignore');
    await writeFile(file, original);
    await chmod(file, 0o640);
    const before = await lstat(file);
    await ensureAtlasIgnored(root);
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    assert.equal(
      await readFile(file, 'utf8'),
      original + (original && !original.endsWith('\n') ? newline : '') + '/.atlas/' + newline
    );
    const after = await lstat(file);
    assert.notEqual(after.ino, before.ino);
    assert.equal(after.mode & 0o777, 0o640);
    assert.deepEqual(
      (await readdir(root)).filter(name => name.includes('.tmp')),
      []
    );
  });
}

test('已有完全相同规则时保留注释、换行及文件身份', async t => {
  const root = await fixture(t);
  const file = join(root, '.gitignore');
  const original = '# 本机工具\r\n/.atlas/\r\n/build/';
  await writeFile(file, original);
  const before = await lstat(file);
  await ensureAtlasIgnored(root);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal((await lstat(file)).ino, before.ino);
});

test('不跟随根忽略文件符号链接，也不覆盖非文件', async t => {
  const root = await fixture(t);
  const target = join(root, 'target');
  await writeFile(target, '# 外部规则\n');
  const file = join(root, '.gitignore');
  await symlink(target, file);
  await assert.rejects(ensureAtlasIgnored(root), /符号链接/);
  assert.equal(await readFile(target, 'utf8'), '# 外部规则\n');
  await rm(file);
  await mkdir(file);
  await assert.rejects(ensureAtlasIgnored(root), /普通文件/);
});

test('拒绝当前工程已跟踪文件，保留索引和其他工程改动', async t => {
  const root = await fixture(t);
  const app = join(root, 'app');
  await mkdir(join(app, '.atlas'), {recursive: true});
  await mkdir(join(root, 'other', '.atlas'), {recursive: true});
  await writeFile(join(root, 'other', '.atlas', 'atlas.yaml'), 'title: 其他工程\n');
  await git(root, 'add', 'other');
  await writeFile(join(root, 'user.txt'), '未提交改动');
  await ensureAtlasIgnored(app);
  await writeFile(join(app, '.atlas', 'atlas.yaml'), 'title: 本机配置\n');
  await git(root, 'add', '--force', 'app/.atlas/atlas.yaml');
  const before = (await git(root, 'ls-files', '--stage')).stdout;
  await assert.rejects(ensureAtlasIgnored(app), /已被 Git 跟踪.*取消跟踪/s);
  assert.equal((await git(root, 'ls-files', '--stage')).stdout, before);
  assert.equal(await readFile(join(root, 'user.txt'), 'utf8'), '未提交改动');
});

test('无 Git 仓库的 Flutter 工程仍预置根忽略规则', async t => {
  const root = await fixture(t, false);
  await ensureAtlasIgnored(root);
  assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), '/.atlas/\n');
});

test('已有规则被后续反向规则撤销时明确拒绝', async t => {
  const root = await fixture(t);
  const file = join(root, '.gitignore');
  const original = '/.atlas/\n!/.atlas/\n';
  await writeFile(file, original);
  await assert.rejects(ensureAtlasIgnored(root), /忽略规则.*生效/);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('不能用仅忽略 YAML 冒充整个本机目录私有', async t => {
  const root = await fixture(t);
  const file = join(root, '.gitignore');
  const original = '/.atlas/\n!/.atlas/\n/.atlas/atlas.yaml\n';
  await writeFile(file, original);
  await assert.rejects(ensureAtlasIgnored(root), /忽略规则.*生效/);
  assert.equal(await readFile(file, 'utf8'), original);
});
