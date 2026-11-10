import {readFile, realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const distribution = fileURLToPath(new URL('../../dist/', import.meta.url));
const allowedArtifact = /^\/(?:manifest\.json|latest-attempt\.json|[0-9TZ-]+\/(?:manifest\.json|attempt\.json|[0-9]+\.png))$/;
const mediaTypes = {'html': 'text/html; charset=utf-8', 'js': 'text/javascript; charset=utf-8',
  'css': 'text/css; charset=utf-8', 'json': 'application/json', 'png': 'image/png', 'svg': 'image/svg+xml'};

async function readWithin(directory, path) {
  const root = await realpath(directory);
  const file = await realpath(resolve(root, path));
  const name = relative(root, file);
  if (!name || name === '..' || name.startsWith('..' + sep) || isAbsolute(name)) return null;
  return readFile(file);
}

export async function serveViewer({config, port, output, publicPath, sourceFingerprint}) {
  const template = await readFile(resolve(distribution, 'index.html'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw Error('找不到预编译的 Viewer。源码检出请先运行 pnpm build。');
    throw error;
  });
  // 仅注入 JSON。避免配置文本结束 script 标签。
  const html = template.replace(
    '<script type="application/json" id="atlas-config"></script>',
    () => `<script type="application/json" id="atlas-config">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`,
  );
  if (html === template) throw Error('Viewer 构建缺少配置入口，请重新打包。');

  const server = createServer(async (request, response) => {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) {
      response.writeHead(421).end();
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, {Allow: 'GET, HEAD'}).end();
      return;
    }
    const pathname = (request.url ?? '').split('?', 1)[0];
    const send = (body, type) => {
      response.writeHead(200, {'Content-Type': type, 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body)});
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      if (pathname === '/' || pathname === '/index.html') {
        send(html, mediaTypes.html);
        return;
      }
      if (pathname === '/__atlas/source' && sourceFingerprint) {
        try {
          send(JSON.stringify({fingerprint: await sourceFingerprint()}), mediaTypes.json);
        } catch {
          response.writeHead(503).end();
        }
        return;
      }
      const artifact = pathname.startsWith(publicPath + '/') ? pathname.slice(publicPath.length) : '';
      const data = allowedArtifact.test(artifact) ? await readWithin(output, artifact.slice(1))
        : /^\/assets\/[\w.-]+$/.test(pathname) ? await readWithin(distribution, pathname.slice(1)) : null;
      if (!data) {
        response.writeHead(404).end();
        return;
      }
      send(data, mediaTypes[pathname.split('.').at(-1)] ?? 'application/octet-stream');
    } catch (error) {
      response.writeHead(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch(error => {
    if (error.code === 'EADDRINUSE') throw Error(`画布端口 ${port} 已被占用，请用 --port 选择其他端口。`);
    throw error;
  });
  console.log(`Flutter UI Atlas: http://127.0.0.1:${port}/`);
}
