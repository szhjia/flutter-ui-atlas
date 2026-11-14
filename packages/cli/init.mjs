import {ensureApplicationIdentity} from './application-identity.mjs';
import {lstat, mkdir, open, readFile, unlink} from 'node:fs/promises';
import {basename, dirname, extname, join, relative, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin, stdout} from 'node:process';
import {parse, stringify} from 'yaml';
import {ensureAtlasIgnored} from './project-ignore.mjs';
import {localWebDiscovery} from './local-web.mjs';
import {findFlutterProject, readConfigFile, resolveProjectConfig, validateAtlasOutput} from './project.mjs';

const guide = artifactDirectory => `# Atlas project guide

Edit \`.atlas/atlas.yaml\` from your Flutter project. \`baseUrl\` is the running Flutter Web URL; \`port\` is the canvas port.

Start the app with your usual tools, then run from its project directory:

\`\`\`sh
atlas config
atlas build
atlas view
\`\`\`

Open the address printed by \`atlas view\`. Screenshots and capture reports are written to \`.atlas/${artifactDirectory}/\`. A failed capture keeps the last successful map.

- For a single entry screen, set \`readyText\` to its exact visible text. Without it, Atlas records only a candidate.
- For multiple pages, declare routes and readiness checks in \`screens\`, and real actions in \`edges\`.
- Use \`atlas config\` to manage authentication and accounts. Keep passwords out of YAML.
- A trusted local MJS adapter can be referenced with \`adapterConfig\`. Recording requires an adapter with \`discovery\`.
- The entire \`.atlas/\` directory is local and ignored in the project root \`.gitignore\`. Do not commit configuration, credentials, or generated files.
`;

async function createOnce(file, contents, created, optional = false) {
  try {
    const handle = await open(file, 'wx');
    try {
      const info = await handle.stat();
      created.push({file, info, contents});
      await handle.writeFile(contents);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!optional) throw Error(`Atlas 已初始化：${file}`);
  }
}

export async function initAtlas(options, {cwd = process.cwd(), input = stdin, output = stdout} = {}) {
  const project = await findFlutterProject(cwd);
  const directory = join(project, '.atlas');
  const file = join(directory, 'atlas.yaml');
  await validateAtlasOutput(directory, join(directory, 'generated'));
  try {
    await lstat(file);
    await ensureAtlasIgnored(project);
    throw Error(`Atlas 已初始化：${file}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let adapterFile;
  if (options['adapter-config'] !== undefined) {
    adapterFile = resolve(cwd, options['adapter-config']);
    if (extname(adapterFile) !== '.mjs') throw Error('--adapter-config 必须指向本地 .mjs 配置');
  }
  const selected = adapterFile ? await readConfigFile(adapterFile) : await resolveProjectConfig({cwd});
  let artifactDirectory = 'generated';
  if (!selected.implicit) {
    if (!selected.custom || (!selected.config.adapter && !selected.config.discovery)) {
      throw Error('已有配置无法自动接入，请将其迁入 .atlas/atlas.yaml，或用 --adapter-config 指定 MJS 适配器。');
    }
    adapterFile = selected.file;
    if (options.url !== undefined || options['ready-text'] !== undefined) {
      throw Error('使用适配器时，由适配器配置应用地址和就绪条件');
    }
    if (typeof selected.config.output === 'string') {
      const previousOutput = resolve(selected.directory, selected.config.output);
      const name = basename(previousOutput);
      if (dirname(previousOutput) === directory && /^[\w-]+$/.test(name)) artifactDirectory = name;
    }
    output.write(`沿用现有 Atlas 适配器：${relative(project, adapterFile)}\n`);
  }
  await validateAtlasOutput(directory, join(directory, artifactDirectory));

  const pubspec = parse(await readFile(join(project, 'pubspec.yaml'), 'utf8'));
  const defaultTitle =
    selected.config.title ?? selected.config.viewer?.shell?.title ?? pubspec?.name ?? 'Flutter UI Atlas';
  const terminal = !options.yes && input.isTTY && output.isTTY ? createInterface({input, output}) : null;
  async function field(value, label, fallback) {
    if (value !== undefined) return String(value).trim();
    if (!terminal) return String(fallback);
    const suffix = fallback === '' ? '（可留空）' : ` [${fallback}]`;
    return (await terminal.question(`${label}${suffix}：`)).trim() || String(fallback);
  }

  let config;
  try {
    const title = await field(options.name, '工程显示名', defaultTitle);
    const baseUrl = adapterFile ? undefined : await field(options.url, 'Flutter Web 地址', 'http://127.0.0.1:8080/');
    const port = Number(await field(options.port, 'Atlas 画布端口', selected.config.port ?? 60200));
    const readyText = adapterFile ? undefined : await field(options['ready-text'], '入口页面的就绪文字', '');
    if (!title) throw Error('工程显示名不能为空');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('port 必须是有效的 TCP 端口');
    if (baseUrl !== undefined) localWebDiscovery(baseUrl, readyText);
    config = {
      title,
      port,
      output: artifactDirectory,
      ...(adapterFile ? {adapterConfig: relative(directory, adapterFile)} : {baseUrl, readyText})
    };
  } finally {
    terminal?.close();
  }

  await ensureAtlasIgnored(project);
  await mkdir(directory, {recursive: true});
  const created = [];
  try {
    await createOnce(file, '# Flutter UI Atlas 工程配置\n' + stringify(config), created);
    await createOnce(join(directory, 'README.md'), guide(artifactDirectory), created, true);
    const ignored = [...new Set(['generated', artifactDirectory])].map(path => `/${path}/\n`).join('');
    await createOnce(join(directory, '.gitignore'), ignored, created, true);
  } catch (error) {
    await Promise.allSettled(
      created.map(async ({file, info, contents}) => {
        const current = await lstat(file);
        if (
          current.dev === info.dev &&
          current.ino === info.ino &&
          current.isFile() &&
          (await readFile(file, 'utf8')) === contents
        )
          await unlink(file);
      })
    );
    throw error;
  }
  await ensureApplicationIdentity(directory);
  return file;
}
