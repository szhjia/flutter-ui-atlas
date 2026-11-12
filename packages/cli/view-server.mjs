import {readFile, realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const distribution = fileURLToPath(new URL('../../dist/', import.meta.url));
const allowedArtifact =
  /^\/(?:manifest\.json|latest-attempt\.json|[0-9TZ-]+\/(?:manifest\.json|attempt\.json|[0-9]+\.png))$/;
const mediaTypes = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  png: 'image/png',
  svg: 'image/svg+xml'
};

async function readWithin(directory, path) {
  const root = await realpath(directory);
  const file = await realpath(resolve(root, path));
  const name = relative(root, file);
  if (!name || name === '..' || name.startsWith('..' + sep) || isAbsolute(name)) return null;
  return readFile(file);
}

export async function serveViewer({config, port, output, publicPath, sourceFingerprint, liveSessions}) {
  const token = liveSessions ? randomBytes(32).toString('base64url') : undefined;
  if (liveSessions) config = {...config, managedLive: {endpoint: '/__atlas/live', token}};
  let actualPort = port;
  let closing;
  const template = await readFile(resolve(distribution, 'index.html'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw Error('找不到预编译的 Viewer。源码检出请先运行 pnpm build。');
    throw error;
  });
  // 仅注入 JSON。避免配置文本结束 script 标签。
  const html = template.replace(
    '<script type="application/json" id="atlas-config"></script>',
    () =>
      `<script type="application/json" id="atlas-config">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`
  );
  if (html === template) throw Error('Viewer 构建缺少配置入口，请重新打包。');

  const server = createServer(async (request, response) => {
    if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(request.headers.host)) {
      response.writeHead(421).end();
      return;
    }
    const pathname = (request.url ?? '').split('?', 1)[0];
    if (liveSessions && pathname.startsWith('/__atlas/live')) {
      await handleLive(request, response, pathname);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, {Allow: 'GET, HEAD'}).end();
      return;
    }
    const send = (body, type) => {
      response.writeHead(200, {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
      });
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
      const data = allowedArtifact.test(artifact)
        ? await readWithin(output, artifact.slice(1))
        : /^\/assets\/[\w.-]+$/.test(pathname)
          ? await readWithin(distribution, pathname.slice(1))
          : null;
      if (!data) {
        response.writeHead(404).end();
        return;
      }
      send(data, mediaTypes[pathname.split('.').at(-1)] ?? 'application/octet-stream');
    } catch (error) {
      response.writeHead(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500).end();
    }
  });
  async function handleLive(request, response, pathname) {
    const send = (status, value) => {
      if (response.destroyed || response.writableEnded) return;
      response
        .writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        })
        .end(JSON.stringify(value));
    };
    const fail = (message, status = 400) => {
      throw Object.assign(Error(message), {status});
    };
    try {
      const provided = Buffer.from(request.headers['x-atlas-token'] ?? '');
      const expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) fail('实时会话令牌无效。', 401);
      const origin = `http://${request.headers.host}`;
      if (
        (request.headers.origin !== undefined && request.headers.origin !== origin) ||
        (request.method !== 'GET' && request.headers.origin !== origin)
      )
        fail('拒绝跨来源请求。', 403);
      if (closing) fail('实时服务正在关闭。', 503);
      if (pathname === '/__atlas/live/status' && request.method === 'GET') return send(200, liveSessions.status());
      if (request.method !== 'POST') fail('不支持的请求方法。', 405);
      if (!['/__atlas/live/open', '/__atlas/live/close'].includes(pathname)) fail('实时接口不存在。', 404);
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') fail('仅接受 JSON 请求。', 415);
      const chunks = [];
      let length = 0;
      for await (const chunk of request.iterator({destroyOnReturn: false})) {
        length += chunk.length;
        if (length > 4096) fail('实时会话请求过大。', 413);
        chunks.push(chunk);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        fail('JSON 请求无效。');
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('请求内容必须是对象。');
      const open = pathname.endsWith('/open');
      const allowed = open ? ['screenId', 'captureId', 'requestId'] : ['id'];
      if (
        Object.keys(input).some(key => !allowed.includes(key)) ||
        Object.values(input).some(value => typeof value !== 'string' || !value || value.length > 256) ||
        (open && (!input.screenId || !input.captureId || !input.requestId))
      )
        fail('实时会话仅接受页面、采集及会话标识。');
      if (open) {
        const disconnected = () => {
          if (!response.writableEnded) void liveSessions.close(input.requestId).catch(() => {});
        };
        response.once('close', disconnected);
        try {
          if (response.destroyed) {
            await liveSessions.close(input.requestId);
            return;
          }
          return send(200, await liveSessions.open(input));
        } finally {
          response.off('close', disconnected);
        }
      }
      await liveSessions.close(input.id);
      send(200, liveSessions.status());
    } catch (error) {
      send(error.status ?? (error.name === 'AbortError' ? 409 : 500), {
        message: error.status || error.name === 'AbortError' ? error.message : '实时会话准备失败，请检查终端中的错误。'
      });
    }
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch(error => {
    if (error.code === 'EADDRINUSE') throw Error(`画布端口 ${port} 已被占用，请用 --port 选择其他端口。`);
    throw error;
  });
  actualPort = server.address().port;
  const url = `http://127.0.0.1:${actualPort}/`;
  const stop = () => {
    void close().catch(error => console.error(error.message));
  };
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      const stopped = new Promise((done, reject) => server.close(error => (error ? reject(error) : done())));
      try {
        await liveSessions?.shutdown();
      } finally {
        server.closeAllConnections();
        await stopped;
      }
    })();
    return closing;
  }
  if (liveSessions) {
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
  console.log(`Flutter UI Atlas: ${url}`);
  return {server, close, url, port: actualPort};
}
