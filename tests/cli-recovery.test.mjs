import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

test('采集配置无效时仍能用相同配置查看已有地图及失败报告', {timeout:15000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-view-recovery-'));
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const {port} = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const config = join(directory, 'atlas.json');
  const output = join(directory, 'generated');
  const cli = fileURLToPath(new URL('../packages/cli/index.mjs', import.meta.url));
  let view;
  try {
    await mkdir(output);
    await writeFile(join(output, 'manifest.json'), JSON.stringify({schemaVersion:1,captureId:'old',screens:[],edges:[]}));
    await writeFile(config, JSON.stringify({
      port, output, baseUrl:'http://127.0.0.1:1',
      screens:[{id:'home',title:'首页',route:'/',ready:{}}],
    }));
    const failed = spawn(process.execPath, [cli, 'capture', '--config', config], {stdio:'ignore'});
    assert.deepEqual(await once(failed, 'exit'), [1, null]);
    view = spawn(process.execPath, [cli, 'view', '--config', config], {stdio:['ignore','pipe','pipe']});
    await new Promise((resolve, reject) => {
      let output = '';
      const onExit = code => reject(Error(`预览提前退出 ${code}: ${output}`));
      view.once('exit', onExit);
      view.stderr.on('data', chunk => {output += chunk;});
      view.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes(`http://127.0.0.1:${port}/`)) {
          view.off('exit', onExit);
          resolve();
        }
      });
    });
    const viewer = `http://127.0.0.1:${port}`;
    const html = await (await fetch(viewer)).text();
    const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    assert(script, '安装后的画布应加载预编译脚本');
    assert.equal((await fetch(viewer + script)).status, 200);
    assert.equal((await fetch(viewer + '/src/main.tsx')).status, 404);
    const untrusted = await new Promise((resolve, reject) => {
      request(viewer, {headers: {Host: 'external.invalid'}}, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject).end();
    });
    assert.equal(untrusted, 421);
    const base = `http://127.0.0.1:${port}/generated`;
    assert.equal((await (await fetch(base+'/manifest.json')).json()).captureId, 'old');
    const attempt = await (await fetch(base+'/latest-attempt.json')).json();
    assert.equal(attempt.status, 'failed');
    assert.match(attempt.error, /ready/);
    assert.equal((await fetch(new URL(attempt.report, base))).status, 200);
  } finally {
    if (view && view.exitCode === null && view.signalCode === null) {
      const exited = once(view, 'exit');
      view.kill();
      await exited;
    }
    await rm(directory, {recursive:true, force:true});
  }
});
