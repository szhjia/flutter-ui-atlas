import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {chmod, link, lstat, open, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const sameFile = (a, b) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function git(projectRoot, args) {
  return exec('git', ['-C', projectRoot, ...args], {
    env: {...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0'},
    maxBuffer: 8 * 1024 * 1024
  });
}

async function inspect(file) {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (info.isSymbolicLink()) throw Error(`Atlas 不允许 .gitignore 是符号链接：${file}`);
  if (!info.isFile()) throw Error(`Atlas 要求 .gitignore 是普通文件：${file}`);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!sameFile(info, opened)) throw Error('读取 .gitignore 时文件发生变化，请重试');
    const contents = await handle.readFile();
    if (!sameFile(opened, await handle.stat())) throw Error('读取 .gitignore 时文件发生变化，请重试');
    return {info: opened, contents};
  } finally {
    await handle.close();
  }
}

async function verifyIgnored(projectRoot) {
  try {
    await git(projectRoot, ['check-ignore', '--quiet', '--no-index', '.atlas/']);
  } catch (error) {
    if (error.code === 1) throw Error('工程 .gitignore 的 Atlas 忽略规则未生效，请检查后续反向规则');
    throw error;
  }
}

// 仅查询索引；绝不修改已跟踪文件，也不回滚用户的根忽略文件。
export async function ensureAtlasIgnored(projectRoot) {
  let repository = true;
  try {
    await git(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  } catch (error) {
    if (error.code === 128 && /not a git repository/.test(error.stderr ?? '')) repository = false;
    else throw Error(`无法检查 Atlas 的 Git 跟踪状态：${error.message}`, {cause: error});
  }
  if (repository) {
    const {stdout} = await git(projectRoot, ['ls-files', '-z', '--', '.atlas']);
    if (stdout) throw Error('当前工程 .atlas 内存在已被 Git 跟踪的文件；请先自行取消跟踪，Atlas 不会修改索引。');
  }

  const file = join(projectRoot, '.gitignore');
  const before = await inspect(file);
  const text = before?.contents.toString('utf8') ?? '';
  if (text.split(/\r?\n/).includes('/.atlas/')) {
    if (repository) await verifyIgnored(projectRoot);
    return;
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const suffix = (text && !text.endsWith('\n') ? newline : '') + '/.atlas/' + newline;
  const contents = Buffer.concat([before?.contents ?? Buffer.alloc(0), Buffer.from(suffix)]);
  const temporary = join(projectRoot, `.gitignore.atlas-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', before ? before.info.mode & 0o777 : 0o666);
    await handle.writeFile(contents);
    if (before) await chmod(temporary, before.info.mode & 0o777);
    await handle.sync();
    await handle.close();
    handle = null;
    const current = await inspect(file);
    if (before) {
      if (!current || !sameFile(before.info, current.info) || !before.contents.equals(current.contents)) {
        throw Error('更新 .gitignore 时文件发生变化，已保留用户内容，请重试');
      }
      await rename(temporary, file);
    } else {
      // 硬链接的排他创建避免覆盖在检查后刚出现的用户文件。
      if (current) throw Error('更新 .gitignore 时文件发生变化，已保留用户内容，请重试');
      await link(temporary, file);
    }
    if (repository) await verifyIgnored(projectRoot);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
