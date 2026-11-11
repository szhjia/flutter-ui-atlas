import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

/** 从源码文本提取裸依赖说明符（跳过相对路径与 node: 内建），消除打包依赖集合的手工维护。 */
export function collectExternalImports(texts) {
  const external = new Set();
  for (const text of texts) {
    for (const match of text.matchAll(/(?:from\s*|import\(\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      external.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
    }
  }
  return external;
}

/** 打包 manifest 的单一事实源：engines 原样拷贝（保留上界），依赖由实际 import 映射根清单生成。 */
export function buildManifest(source, external) {
  // 同名冲突时 dependencies 优先（发布语义），devDependencies 仅补充工具链依赖。
  const pool = {...source.devDependencies, ...source.dependencies};
  const missing = [...external].filter(name => pool[name] === undefined);
  if (missing.length) {
    throw Error(`打包依赖未在根 package.json 声明：${missing.join('、')}。请先加入根清单再打包。`);
  }
  return {
    name: source.name, version: source.version, type: source.type, description: source.description,
    engines: source.engines,
    bin: {atlas: './packages/cli/atlas.mjs'},
    files: ['dist', 'packages/cli', 'packages/capture'],
    dependencies: Object.fromEntries([...external].sort().map(name => [name, pool[name]])),
  };
}

async function pack(destination) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const stage = await mkdtemp(join(tmpdir(), 'flutter-ui-atlas-pack-'));
  try {
    await mkdir(join(stage, 'packages/capture'), {recursive: true});
    await cp(join(root, 'packages/cli'), join(stage, 'packages/cli'), {recursive: true});
    const captureFiles = [];
    for (const file of await readdir(join(root, 'packages/capture'))) {
      if (file.endsWith('.mjs')) {
        await cp(join(root, 'packages/capture', file), join(stage, 'packages/capture', file));
        captureFiles.push(join(root, 'packages/capture', file));
      }
    }
    const cliFiles = (await readdir(join(root, 'packages/cli')))
      .filter(file => file.endsWith('.mjs'))
      .map(file => join(root, 'packages/cli', file));
    const texts = await Promise.all([...cliFiles, ...captureFiles].map(file => readFile(file, 'utf8')));
    const manifest = buildManifest(source, collectExternalImports(texts));
    await cp(join(root, 'dist'), join(stage, 'dist'), {recursive: true});
    await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    // 冒烟需要解析运行时依赖：stage 内借用根 node_modules（npm pack 不会打包它）。
    await symlink(join(root, 'node_modules'), join(stage, 'node_modules'), 'dir');
    // 产物冒烟：tarball 之前先证明 stage 内 CLI 可执行且版本一致。
    const version = execFileSync(process.execPath, [join(stage, 'packages/cli/atlas.mjs'), '--version'], {encoding: 'utf8'}).trim();
    if (version !== source.version) {
      throw Error(`打包冒烟失败：stage 内 --version 输出 ${version}，期望 ${source.version}`);
    }
    await mkdir(destination, {recursive: true});
    execFileSync('npm', ['pack', '--pack-destination', destination], {cwd: stage, stdio: 'inherit'});
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  await pack(resolve(process.argv[2] ?? '.runtime/packages'));
}
