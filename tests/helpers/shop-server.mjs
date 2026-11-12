import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(process.env.SHOP_DEMO_WEB ?? fileURLToPath(new URL('../../demo/build/web/', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.css': 'text/css'
};

export async function serveShop({port = 60210, directory = root} = {}) {
  const base = await realpath(directory);
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = await realpath(resolve(base, pathname === '/' ? 'index.html' : pathname.slice(1)));
      const name = relative(base, file);
      if (!name || name === '..' || name.startsWith('..' + sep) || isAbsolute(name)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      response.writeHead(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 400).end();
    }
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 60210);
  const server = await serveShop({port, directory: process.argv[3] ?? root});
  console.log(`商城 Demo：http://127.0.0.1:${server.address().port}/`);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
