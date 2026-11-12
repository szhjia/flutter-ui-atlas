import {lstat, mkdir, open, readFile, unlink} from 'node:fs/promises';
import {basename, dirname, extname, join, relative, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin, stdout} from 'node:process';
import {parse, stringify} from 'yaml';
import {ensureAtlasIgnored} from './project-ignore.mjs';
import {localWebDiscovery} from './local-web.mjs';
import {findFlutterProject, readConfigFile, resolveProjectConfig, validateAtlasOutput} from './project.mjs';

const guide = artifactDirectory => `# Atlas 接入说明

在 Flutter 工程根目录修改 \`.atlas/atlas.yaml\`。\`baseUrl\` 是 Flutter Web 地址，\`port\` 是画布端口。

先启动应用的 Flutter Web 开发服务，再从 Flutter 工程运行：

\`\`\`sh
atlas build
atlas view
\`\`\`

打开 \`atlas view\` 打印的地址。截图和采集报告写入 \`.atlas/${artifactDirectory}/\`。重新采集失败时，画布仍可读取上一次成功结果。

- 单入口用 \`readyText\` 指定页面上的准确可见文字；留空时只登记候选。
- 多页采集用 \`screens\` 登记路由及就绪条件，用 \`edges\` 登记实际点击。
- 复杂项目可通过 \`adapterConfig\` 引用可信的本地 MJS 配置。需要录制时，适配器需提供 \`discovery\`。
- 整个 \`.atlas/\` 目录仅供本机使用，已在工程根 \`.gitignore\` 中忽略；请勿提交配置、凭据和采集产物。
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
  return file;
}
