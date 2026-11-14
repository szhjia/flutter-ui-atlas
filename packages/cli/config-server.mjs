import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {ConfigError, object} from './config-values.mjs';

const distribution = fileURLToPath(new URL('../../dist/', import.meta.url));
const types = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png'
};
async function body(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new ConfigError('仅接受 JSON 请求。', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({destroyOnReturn: false})) {
    length += chunk.length;
    if (length > 65_536) throw new ConfigError('请求内容超过 64 KiB。', 413);
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ConfigError('JSON 请求无效。');
  }
  if (!object(value)) throw new ConfigError('请求内容必须是对象。');
  return value;
}
export async function serveConfig({store, authentication, port = 0, staticRoot = distribution}) {
  let template;
  try {
    template = await readFile(resolve(staticRoot, 'config.html'));
  } catch {
    throw new ConfigError('找不到预编译的配置页，源码检出请先运行 pnpm build。', 500);
  }
  const token = randomBytes(32).toString('base64url');
  let origin;
  let closing = false;
  const active = new Set();
  const server = createServer((request, response) => {
    const work = handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    active.add(work);
    work.finally(() => active.delete(work));
  });
  async function handle(request, response) {
    const send = (status, value, type = 'application/json') => {
      if (response.destroyed || response.writableEnded) return;
      const data = Buffer.isBuffer(value) ? value : JSON.stringify(value);
      response.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Length': Buffer.byteLength(data),
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'"
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    };
    try {
      if (request.headers.host !== new URL(origin).host) throw new ConfigError('请求来源主机无效。', 421);
      if (closing) throw new ConfigError('配置服务正在关闭。', 503);
      const pathname = new URL(request.url, origin).pathname;
      if (pathname.startsWith('/api/')) {
        const provided = Buffer.from(request.headers['x-atlas-token'] ?? '');
        const expected = Buffer.from(token);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
          throw new ConfigError('配置会话已失效，请重新打开终端中的入口。', 401);
        if (
          (request.headers.origin !== undefined && request.headers.origin !== origin) ||
          (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin)
        ) {
          throw new ConfigError('拒绝跨来源请求。', 403);
        }
        if (request.method === 'GET' && pathname === '/api/health') return send(200, {connected: true});
        if (request.method === 'GET' && pathname === '/api/config') return send(200, await store.load());
        if (request.method !== 'POST') throw new ConfigError('不支持的请求方法。', 405);
        const input = await body(request);
        if (pathname === '/api/project') return send(200, await store.saveProject(input));
        if (pathname === '/api/role') return send(200, await store.saveRole(input));
        if (pathname === '/api/enabled') return send(200, await store.setEnabled(input.id, input.enabled));
        if (pathname === '/api/delete-role') {
          await store.deleteRole(input.id, input.revision);
          return send(200, {deleted: true});
        }
        if (pathname === '/api/test-login') {
          const attempt = await store.prepareLogin(input);
          return send(200, store.recordLogin(attempt, await authentication.test(attempt)));
        }
        throw new ConfigError('接口不存在。', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new ConfigError('不支持的请求方法。', 405);
      if (pathname === '/' || pathname === '/config.html') return send(200, template, types.html);
      if (!/^\/assets\/[\w.-]+$/.test(pathname)) throw new ConfigError('资源不存在。', 404);
      const base = await realpath(staticRoot);
      const target = await realpath(resolve(base, pathname.slice(1)));
      const name = relative(base, target);
      if (isAbsolute(name) || name === '..' || name.startsWith('..' + sep)) throw new ConfigError('资源不存在。', 404);
      return send(200, await readFile(target), types[pathname.split('.').at(-1)] ?? 'application/octet-stream');
    } catch (error) {
      const status =
        error instanceof ConfigError ? error.status : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500;
      send(status, {
        message:
          error instanceof ConfigError
            ? error.message
            : status === 404
              ? '资源不存在。'
              : '配置操作失败，原配置已保留；请检查本机文件权限后重试。'
      });
    }
  }
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  }).catch(error => {
    if (error.code === 'EADDRINUSE') throw new ConfigError('配置页端口已被占用，请用 --port 选择其他端口。');
    throw error;
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    token,
    url: `${origin}/#token=${token}`,
    async close() {
      closing = true;
      const stopped = new Promise((done, reject) => server.close(error => (error ? reject(error) : done())));
      await authentication.close();
      server.closeAllConnections();
      await Promise.allSettled([...active]);
      await stopped;
    }
  };
}
