import {annotateWorkspaceFreshness, withApplicationWriter, publishLegacyWorkspaces} from './workspace-build.mjs';
import {diagnose} from './doctor.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {capture} from '../capture/index.mjs';
import {runDiscovery} from '../capture/discovery.mjs';
import {declarativeConfig, sourceFingerprintForFiles, webUrl} from '../capture/declarative.mjs';

import {resolveProjectConfig, validateAtlasOutput, selectProfiles} from './project.mjs';
import {initAtlas} from './init.mjs';
import {localWebDiscovery} from './local-web.mjs';
import {serveViewer} from './view-server.mjs';
import {assertLoopback} from '../capture/web-boundary.mjs';
import {configCommand} from './config-command.mjs';
import {launchManagedBrowser} from './managed-browser.mjs';
import {isStandardProject, buildStandard, standardLiveSessions, profileOutput} from './managed-workflow.mjs';

const usage = `用法：
  atlas config [--config <工程 .atlas/atlas.yaml>] [--port <端口，0 为自动>] [--no-open]
  atlas init [--name <工程名>] [--url <Flutter Web 地址>] [--port <画布端口>] [--ready-text <就绪文字>] [--yes]
  atlas init --adapter-config <本地 MJS 配置> [--name <工程名>] [--port <画布端口>] [--yes]
  atlas build --url <本地 Flutter Web 地址> [--ready-text <就绪文字>]
  atlas build|capture [--config <配置文件>] [--profile <名称>] [--force]
  atlas record [--config <配置文件>] [--journeys]
  atlas view [--config <配置文件>] [--port <端口>] [--profile <名称>]
  atlas doctor [--config <configuration>]
  atlas --help | --version`;

async function artifactLocation({config, directory, managed}) {
  const publicPath = config.publicPath ?? '/generated';
  if (!/^\/(?:[\w-]+\/)*[\w-]+$/.test(publicPath)) throw Error('publicPath 必须是以 / 开头的资源路径');
  const output = config.output ?? '.atlas/generated';
  if (typeof output !== 'string' || !output.trim()) throw Error('output 必须是目录路径');
  const path = resolve(directory, output);
  if (managed) await validateAtlasOutput(directory, path);
  return {publicPath, output: path};
}

/** 浏览器通道解析：环境变量 ATLAS_BROWSER_CHANNEL 优先于配置 browserChannel，默认 chrome。 */
export function resolveBrowserChannel(config = {}, env = process.env) {
  const fromEnv = env.ATLAS_BROWSER_CHANNEL;
  const channel =
    fromEnv !== undefined ? fromEnv : config.browserChannel !== undefined ? config.browserChannel : 'chrome';
  const source = fromEnv !== undefined ? 'ATLAS_BROWSER_CHANNEL' : 'browserChannel';
  if (typeof channel !== 'string' || !channel.trim()) {
    throw Error(`${source} 必须是非空的浏览器通道名（如 chrome、chromium、msedge）`);
  }
  return channel.trim();
}

async function openChrome(headless, channel) {
  return launchManagedBrowser({channel, headless});
}

const defaultViewport = {width: 393, height: 852};
function validViewport(viewport) {
  return [viewport?.width, viewport?.height].every(value => Number.isSafeInteger(value) && value > 0);
}

function captureAdapter({config, custom, directory}) {
  if (!validViewport(config.viewport ?? defaultViewport)) {
    throw Error('viewport 的 width 和 height 必须是正整数');
  }
  if (config.requireObservedEdges !== undefined && typeof config.requireObservedEdges !== 'boolean') {
    throw Error('requireObservedEdges 必须是布尔值');
  }
  if (!custom) return declarativeConfig(config, directory).adapter;
  if (!config.adapter) throw Error('.mjs 配置必须提供 adapter');
  return config.adapter;
}

async function view(input, portOverride) {
  const {config, custom, directory, output, publicPath, implicit, entryMode} = input;
  const viewport = validViewport(config.viewport) ? config.viewport : defaultViewport;
  const previewUrls = custom
    ? Object.fromEntries(Object.entries(config.previewUrls ?? {}).map(([id, address]) => [id, webUrl(address).href]))
    : {};
  const activeAdapter = config.discovery ?? config.adapter;
  const viewer = config.viewer;
  const preview = viewer?.preview ?? config.discovery?.preview;
  let browserPreview = preview
    ? {
        origin: webUrl(preview.origin).origin,
        sessionParam: preview.sessionParam,
        entries: preview.entries,
        query: preview.query
      }
    : implicit || entryMode
      ? {routeMode: 'pathname', localOnly: true}
      : !custom
        ? {routeMode: config.routeMode === 'pathname' ? 'pathname' : 'hash'}
        : Object.keys(previewUrls).length
          ? {urls: previewUrls}
          : undefined;
  if (browserPreview?.origin) {
    assertLoopback(new URL(browserPreview.origin), {
      allowRemote: config.allowRemoteUrls === true,
      message: 'preview.origin 必须是本地回环地址；如需局域网或远程预览源，在配置中设置 allowRemoteUrls: true。'
    });
  }
  const sourceFingerprint = custom
    ? activeAdapter?.sourceFingerprint?.bind(activeAdapter)
    : config.sourceFiles?.length
      ? () => sourceFingerprintForFiles(config.sourceFiles, directory)?.()
      : undefined;
  const port = portOverride ?? config.port ?? 60200;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('port 必须是有效的 TCP 端口');
  const liveSessions = isStandardProject(input)
    ? await standardLiveSessions({...input, output: input.baseOutput}, input.profile, () =>
        openChrome(false, resolveBrowserChannel(config))
      )
    : undefined;
  await serveViewer({
    port,
    output,
    publicPath,
    sourceFingerprint,
    liveSessions,
    workspaceOutput: input.baseOutput ?? output,
    profileName: input.profile?.name ?? null,
    workspaceStatus: isStandardProject(input) ? bundle => annotateWorkspaceFreshness(bundle, directory) : undefined,
    config: {
      artifactPaths: [publicPath],
      shell: {title: config.title ?? 'Flutter UI Atlas', ...viewer?.shell},
      sharedRoles: viewer?.sharedRoles,
      captureHint:
        viewer?.captureHint ??
        (implicit ? 'atlas build --url <local-web-url> --ready-text <ready-text>' : 'atlas build'),
      fingerprintUrl: sourceFingerprint ? '/__atlas/source' : undefined,
      workspaceStatusUrl: isStandardProject(input) ? '/__atlas/workspaces' : undefined,
      preview: liveSessions ? undefined : browserPreview,
      layoutKey:
        config.layoutKey ??
        `atlas:${createHash('sha256').update(output).digest('hex').slice(0, 16)}:${isStandardProject(input) ? 'workspace-v2' : `${viewport.width}x${viewport.height}:v1`}`
    }
  });
}

export async function runAtlas(args = process.argv.slice(2)) {
  try {
    const {positionals, values} = parseArgs({
      args,
      allowPositionals: true,
      options: {
        config: {type: 'string'},
        help: {type: 'boolean', short: 'h'},
        version: {type: 'boolean'},
        journeys: {type: 'boolean'},
        url: {type: 'string'},
        'ready-text': {type: 'string'},
        port: {type: 'string'},
        name: {type: 'string'},
        yes: {type: 'boolean', short: 'y'},
        'adapter-config': {type: 'string'},
        'no-open': {type: 'boolean'},
        profile: {type: 'string'},
        force: {type: 'boolean'}
      }
    });
    if (values.help) {
      console.log(usage);
      return 0;
    }
    if (values.version) {
      const {version} = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
      console.log(version);
      return 0;
    }
    const [command] = positionals;
    if (command === 'doctor') {
      let project;
      try {
        project = await resolveProjectConfig({configFile: values.config});
      } catch (error) {
        if (values.config) throw error;
      }
      const report = await diagnose({
        config: project?.implicit ? undefined : project?.config,
        directory: project?.directory
      });
      console.log(JSON.stringify(report, null, 2));
      return report.ok ? 0 : 1;
    }
    if (values.force && command !== 'build' && command !== 'capture')
      throw Error('--force is only supported for build/capture.');
    if (command === 'config') {
      if (
        positionals.length !== 1 ||
        values.profile !== undefined ||
        values.journeys ||
        values.name !== undefined ||
        values.yes ||
        values.url !== undefined ||
        values['ready-text'] !== undefined ||
        values['adapter-config'] !== undefined
      )
        throw Error(usage);
      await configCommand(values, () => openChrome(true, resolveBrowserChannel()));
      return 0;
    }
    if (values['no-open'] !== undefined) throw Error(usage);
    if (command === 'init') {
      if (positionals.length !== 1 || values.profile !== undefined || values.config !== undefined || values.journeys)
        throw Error(usage);
      const file = await initAtlas(values);
      console.log(`已生成 ${file}\n启动 Flutter Web 后运行 atlas build 和 atlas view。`);
      return 0;
    }
    const building = command === 'build' || command === 'capture';
    if (
      positionals.length !== 1 ||
      (!building && command !== 'record' && command !== 'view') ||
      values.name !== undefined ||
      values.yes ||
      values['adapter-config'] !== undefined ||
      (values.profile !== undefined && command === 'record') ||
      (values.journeys && command !== 'record') ||
      (values.port !== undefined && command !== 'view') ||
      ((values.url !== undefined || values['ready-text'] !== undefined) && !building) ||
      (values['ready-text'] !== undefined && (!values.url || !values['ready-text'].trim()))
    )
      throw Error(usage);
    const project = await resolveProjectConfig({configFile: values.config});
    const input = {...project, ...(await artifactLocation(project))};
    const profiles = selectProfiles(input.config, values.profile);
    if (command === 'view') {
      const profile = profiles[0];
      await view(
        {
          ...input,
          profile,
          baseOutput: input.output,
          config: {...input.config, viewport: profile.viewport},
          output: profileOutput(input.output, profile)
        },
        values.port === undefined ? undefined : Number(values.port)
      );
      return 0;
    }
    if (values.url !== undefined && !project.implicit) throw Error('当前工程已有配置，请使用配置中的开发地址。');
    if (project.implicit && (!building || !values.url)) {
      throw Error(building ? '请用 --url 指定已运行的本地 Flutter Web 地址。' : '录制需要 discovery 配置。');
    }
    if (project.entryMode && !building) throw Error('录制需要 discovery 配置，可通过 adapterConfig 接入');
    const discovery = project.implicit
      ? localWebDiscovery(values.url, values['ready-text']?.trim())
      : project.entryMode
        ? localWebDiscovery(input.config.baseUrl, input.config.readyText?.trim() || undefined, {
            allowRemote: input.config.allowRemoteUrls === true,
            label: 'baseUrl'
          })
        : input.config.discovery;
    const viewport = input.config.viewport ?? defaultViewport;
    if (discovery) {
      if (!validViewport(viewport)) throw Error('viewport 的 width 和 height 必须是正整数');
      const mode = building ? 'capture' : values.journeys ? 'journeys' : 'manual';
      const result = await withApplicationWriter(input, async () => {
        const result = await runDiscovery({
          ...input,
          discovery,
          viewport,
          mode,
          launchBrowser: () => openChrome(mode !== 'manual', resolveBrowserChannel(input.config))
        });
        await publishLegacyWorkspaces(input, result);
        return result;
      });
      console.log(
        JSON.stringify({
          captureId: result.captureId,
          captured: result.screens.filter(screen => screen.status === 'captured').length,
          pending: result.screens.filter(screen => screen.status === 'pending').length,
          observedEdges: result.edges.length
        })
      );
      return 0;
    }
    if (command === 'record') throw Error('录制需要 discovery 配置');
    if (isStandardProject(input))
      return buildStandard(input, profiles, () => openChrome(true, resolveBrowserChannel(input.config)), {
        force: values.force === true
      });
    if (profiles.length > 1 || profiles[0].name) throw Error('命名视口需要标准 .atlas/atlas.yaml 页面配置');
    const result = await withApplicationWriter(input, async () => {
      const result = await capture({
        output: input.output,
        publicPath: input.publicPath,
        viewport: input.config.viewport ?? defaultViewport,
        requireObservedEdges: input.config.requireObservedEdges,
        adapter: () => captureAdapter(input),
        launchBrowser: () => openChrome(true, resolveBrowserChannel(input.config))
      });
      await publishLegacyWorkspaces(input, result);
      return result;
    });
    const summary = {
      captureId: result.captureId,
      pages: result.screens.length,
      captured: result.screens.filter(screen => screen.status === 'captured').length,
      observedEdges: result.edges.filter(edge => edge.status === 'observed').length,
      failedEdges: result.edges.filter(edge => edge.status === 'failed').length,
      runtimeErrors: result.runtimeErrors.length
    };
    console.log(JSON.stringify(summary));
    return summary.captured !== summary.pages || summary.failedEdges || summary.runtimeErrors ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runAtlas();
}
