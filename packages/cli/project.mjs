import {lstat, readFile, stat, realpath} from 'node:fs/promises';
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'yaml';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function findFlutterProject(cwd) {
  let current = await realpath(cwd);
  while (true) {
    const pubspec = join(current, 'pubspec.yaml');
    if (await exists(pubspec)) {
      const {dependencies, dev_dependencies: devDependencies} = parse(await readFile(pubspec, 'utf8')) ?? {};
      if (dependencies?.flutter?.sdk === 'flutter' || devDependencies?.flutter?.sdk === 'flutter') return current;
    }
    const parent = dirname(current);
    if (parent === current) throw Error('未找到 Flutter 工程，请从 Flutter 工程目录运行，或使用 --config。');
    current = parent;
  }
}

async function configAt(directory) {
  const paths = ['atlas.config.json', 'atlas.config.mjs'].map(name => join(directory, name));
  const present = (await Promise.all(paths.map(exists))).flatMap((found, index) => found ? [paths[index]] : []);
  if (present.length > 1) throw Error(`${directory} 同时有两种 Atlas 配置，请使用 --config 选择。`);
  return present[0];
}

export async function readConfigFile(file) {
  const directory = dirname(file);
  const extension = extname(file);
  const yaml = extension === '.yaml' || extension === '.yml';
  const custom = extension === '.mjs';
  if (!yaml && !custom && extension !== '.json') throw Error('配置文件必须是 .yaml、.yml、.json 或 .mjs');
  const config = custom ? (await import(pathToFileURL(file))).default
    : (yaml ? parse : JSON.parse)(await readFile(file, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('配置必须是对象');
  if (!yaml) return {config, custom, directory, file};
  if (config.readyText !== undefined && typeof config.readyText !== 'string') throw Error('readyText 必须是文字');
  if (config.allowRemoteUrls !== undefined && typeof config.allowRemoteUrls !== 'boolean') {
    throw Error('allowRemoteUrls 必须是布尔值');
  }
  const managed = basename(directory) === '.atlas';
  const output = config.output ?? 'generated';
  const {adapterConfig, ...settings} = config;
  if (adapterConfig === undefined) {
    return {config: {...settings, output}, custom: false, directory, managed, entryMode: settings.screens === undefined};
  }
  if (typeof adapterConfig !== 'string' || extname(adapterConfig) !== '.mjs') {
    throw Error('adapterConfig 必须指向受信任的本地 .mjs 配置');
  }
  const adapter = await readConfigFile(resolve(directory, adapterConfig));
  if (!adapter.config.adapter && !adapter.config.discovery) throw Error('adapterConfig 必须提供 adapter 或 discovery');
  return {config: {...adapter.config, ...settings, output}, custom: true, directory, managed};
}

export async function validateAtlasOutput(directory, output) {
  const path = relative(directory, output);
  if (!path || isAbsolute(path) || path === '..' || path.startsWith('..' + sep)) {
    throw Error('output 必须指向 .atlas 内的子目录');
  }
  let current = directory;
  for (const part of ['', ...path.split(sep)]) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory()) throw Error(`Atlas 目录必须是实际目录：${current}`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

export async function resolveProjectConfig({cwd = process.cwd(), configFile} = {}) {
  if (configFile !== undefined) return readConfigFile(resolve(cwd, configFile));
  const project = await findFlutterProject(cwd);
  const yaml = join(project, '.atlas', 'atlas.yaml');
  if (await exists(yaml)) return readConfigFile(yaml);
  const local = await configAt(project);
  if (local) return readConfigFile(local);

  let workspace = project;
  while (true) {
    const external = await configAt(join(workspace, 'tools', 'app-atlas'));
    if (external) {
      const loaded = await readConfigFile(external);
      if (typeof loaded.config.flutterProject !== 'string' || !loaded.config.flutterProject.trim()) {
        throw Error(`${external} 必须用 flutterProject 声明对应的 Flutter 工程。`);
      }
      const target = await realpath(resolve(loaded.directory, loaded.config.flutterProject));
      if (target === project) return loaded;
    }
    const parent = dirname(workspace);
    if (parent === workspace || await exists(join(workspace, '.git'))) break;
    workspace = parent;
  }
  return {config: {output: 'generated'}, custom: false, directory: join(project, '.atlas'), managed: true, implicit: true};
}
