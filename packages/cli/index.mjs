import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {capture} from '../capture/index.mjs';
import {runDiscovery} from '../capture/discovery.mjs';
import {declarativeConfig, sourceFingerprintForFiles, webUrl} from '../capture/declarative.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = '用法：atlas capture|record|view --config <配置文件> [--journeys]';

async function readConfig(file) {
  const path = resolve(file);
  const directory = dirname(path);
  const custom = path.endsWith('.mjs');
  if (!custom && !path.endsWith('.json')) throw Error('配置文件必须是 .json 或 .mjs');
  const config = custom ? (await import(pathToFileURL(path))).default : JSON.parse(await readFile(path, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('配置必须是对象');
  const publicPath = config.publicPath ?? '/generated';
  if (!/^\/(?:[\w-]+\/)*[\w-]+$/.test(publicPath)) throw Error('publicPath 必须是以 / 开头的资源路径');
  const output = config.output ?? '.atlas/generated';
  if (typeof output !== 'string' || !output.trim()) throw Error('output 必须是目录路径');
  return {config, custom, directory, publicPath, output: resolve(directory, output)};
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

async function view(input) {
  const {config, custom, directory, output, publicPath} = input;
  const viewport = validViewport(config.viewport) ? config.viewport : defaultViewport;
  const previewUrls = custom ? Object.fromEntries(Object.entries(config.previewUrls ?? {})
    .map(([id, address]) => [id, webUrl(address).href])) : {};
  const activeAdapter = config.discovery ?? config.adapter;
  const viewer = config.viewer;
  const preview = viewer?.preview ?? config.discovery?.preview;
  const browserPreview = preview
    ? {origin: webUrl(preview.origin).origin, sessionParam: preview.sessionParam, entries: preview.entries, query: preview.query}
    : !custom ? {routeMode: config.routeMode === 'pathname' ? 'pathname' : 'hash'}
    : Object.keys(previewUrls).length ? {urls: previewUrls} : undefined;
  const sourceFingerprint = custom
    ? activeAdapter?.sourceFingerprint?.bind(activeAdapter)
    : (config.sourceFiles?.length ? () => sourceFingerprintForFiles(config.sourceFiles, directory)?.() : undefined);
  const port = config.port ?? 60200;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('port 必须是有效的 TCP 端口');
  const {createServer} = await import('vite');
  const server = await createServer({
    root,
    publicDir: false,
    define: {__ATLAS_CONFIG__: JSON.stringify({
      artifactPaths: [publicPath],
      shell: {title: config.title ?? 'Flutter UI Atlas', ...viewer?.shell},
      sharedRoles: viewer?.sharedRoles,
      captureHint: viewer?.captureHint ?? 'rtk proxy pnpm atlas capture --config <配置文件>',
      fingerprintUrl: sourceFingerprint ? '/__atlas/source' : undefined,
      preview: browserPreview,
      layoutKey: config.layoutKey ?? `atlas:${createHash('sha256').update(output).digest('hex').slice(0, 16)}:${viewport.width}x${viewport.height}:v1`,
    })},
    server: {host: '127.0.0.1', port, strictPort: true},
    plugins: [{
      name: 'atlas-artifacts',
      configureServer(server) {
        if (sourceFingerprint) server.middlewares.use('/__atlas/source', async (_request, response) => {
          try {
            const fingerprint = await sourceFingerprint();
            response.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
              .end(JSON.stringify({fingerprint}));
          } catch {
            response.writeHead(503).end();
          }
        });
        server.middlewares.use(publicPath, async (request, response) => {
          const path = (request.url ?? '').split('?', 1)[0];
          if (!/^\/(?:manifest\.json|latest-attempt\.json|[0-9TZ-]+\/(?:manifest\.json|attempt\.json|[0-9]+\.png))$/.test(path)) {
            response.writeHead(404).end();
            return;
          }
          try {
            const data = await readFile(resolve(output, `.${path}`));
            response.writeHead(200, {
              'Content-Type': path.endsWith('.png') ? 'image/png' : 'application/json',
              'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
            }).end(data);
          } catch (error) {
            response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500).end();
          }
        });
      },
    }],
  });
  await server.listen();
  server.printUrls();
}

export async function runAtlas(args = process.argv.slice(2)) {
  try {
    const {positionals, values} = parseArgs({
      args, allowPositionals: true, options: {config: {type: 'string'}, help: {type: 'boolean', short: 'h'}, journeys: {type: 'boolean'}},
    });
    if (values.help) {
      console.log(usage);
      return 0;
    }
    const [command] = positionals;
    if (!['capture', 'record', 'view'].includes(command) || positionals.length !== 1 || !values.config || (values.journeys && command !== 'record')) throw Error(usage);
    const input = await readConfig(values.config);
    if (command === 'view') {
      await view(input);
      return 0;
    }
    const {discovery, viewport = defaultViewport} = input.config;
    if (discovery) {
      if (!validViewport(viewport)) throw Error('viewport 的 width 和 height 必须是正整数');
      const mode = command === 'capture' ? 'capture' : values.journeys ? 'journeys' : 'manual';
      const result = await runDiscovery({...input, discovery, viewport, mode,
        launchBrowser: () => chromium.launch({channel: 'chrome', headless: mode !== 'manual'}),
      });
      console.log(JSON.stringify({
        captureId: result.captureId,
        captured: result.screens.filter(screen => screen.status === 'captured').length,
        pending: result.screens.filter(screen => screen.status === 'pending').length,
        observedEdges: result.edges.length,
      }));
      return 0;
    }
    if (command === 'record') throw Error('录制需要 discovery 配置');
    const result = await capture({
      output: input.output, publicPath: input.publicPath,
      viewport: input.config.viewport ?? defaultViewport,
      requireObservedEdges: input.config.requireObservedEdges,
      adapter: () => captureAdapter(input),
      launchBrowser: () => chromium.launch({channel: 'chrome', headless: true}),
    });
    const summary = {
      captureId: result.captureId, pages: result.screens.length,
      captured: result.screens.filter(screen => screen.status === 'captured').length,
      observedEdges: result.edges.filter(edge => edge.status === 'observed').length,
      failedEdges: result.edges.filter(edge => edge.status === 'failed').length,
      runtimeErrors: result.runtimeErrors.length,
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
