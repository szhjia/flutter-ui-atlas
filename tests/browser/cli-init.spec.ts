import {expect, test} from '@playwright/test';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

test('init 后直接 build，将截图和失败报告发布在 .atlas 下', async () => {
  // 两次 build 分别启动 Chrome，第二次还需要等完 CLI 的 15 秒就绪时限。
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), 'atlas-init-browser-'));
  let body = '<h1>示例首页</h1>';
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(body);
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('本地开发服务未监听');
    const url = `http://127.0.0.1:${address.port}/`;
    await writeFile(join(root, 'pubspec.yaml'), 'name: atlas_test\ndependencies: {flutter: {sdk: flutter}}\n');
    const cli = fileURLToPath(new URL('../../packages/cli/atlas.mjs', import.meta.url));
    const atlas = (...args: string[]) => promisify(execFile)(process.execPath, [cli, ...args], {cwd: root});
    await atlas('init', '--yes', '--url', url, '--ready-text', '示例首页');
    await atlas('build');
    const output = join(root, '.atlas/generated');
    const manifestPath = join(output, 'manifest.json');
    const manifest = await readFile(manifestPath, 'utf8');
    const {captureId, screens} = JSON.parse(manifest);
    expect(screens[0]).toMatchObject({entry: url, status: 'captured', image: `/generated/${captureId}/0.png`});
    expect((await readFile(join(output, captureId, '0.png'))).subarray(1, 4).toString()).toBe('PNG');

    body = '<h1>已换页</h1>';
    await expect(atlas('build')).rejects.toThrow('入口未就绪');
    expect(await readFile(manifestPath, 'utf8')).toBe(manifest);
    const attempt = JSON.parse(await readFile(join(output, 'latest-attempt.json'), 'utf8'));
    expect(attempt.status).toBe('failed');
    expect(attempt.captureId).not.toBe(captureId);
  } finally {
    server.close();
    await rm(root, {recursive: true, force: true});
  }
});
