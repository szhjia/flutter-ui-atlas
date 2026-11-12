import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildManifest, collectExternalImports} from '../scripts/pack-cli.mjs';

const source = {
  name: 'flutter-ui-atlas', version: '0.1.0', type: 'module',
  engines: {node: '>=22 <26.13'},
  dependencies: {},
  devDependencies: {playwright: '1.64.1', yaml: '2.8.3', prettier: '3.9.10'},
};

test('collectExternalImports 提取裸说明符，跳过相对与 node: 内建', () => {
  const texts = [
    `import {execFileSync} from 'node:child_process';\nimport {capture} from './index.mjs';\nconst {chromium} = await import('playwright');`,
    `import {parse} from 'yaml';\nimport x from '@scope/pkg/sub';`,
  ];
  assert.deepEqual([...collectExternalImports(texts)].sort(), ['@scope/pkg', 'playwright', 'yaml']);
});

test('buildManifest：engines 原样拷贝含上界，依赖由扫描映射生成', () => {
  const manifest = buildManifest(source, new Set(['playwright', 'yaml']));
  assert.equal(manifest.engines.node, '>=22 <26.13', 'P1-9：不再丢上界');
  assert.deepEqual(manifest.dependencies, {playwright: '1.64.1', yaml: '2.8.3'});
});

test('buildManifest：根清单缺失的依赖给中文报错', () => {
  assert.throws(() => buildManifest(source, new Set(['playwright', 'left-pad'])), /left-pad/);
});

test('端到端：打包脚本退出码 0、生成 tgz、冒烟在 stage 内通过', {timeout: 120_000}, async () => {
  const destination = await mkdtemp(join(tmpdir(), 'atlas-pack-test-'));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const run = spawnSync(process.execPath, [join(root, 'scripts/pack-cli.mjs'), destination], {encoding: 'utf8'});
  assert.equal(run.status, 0, `脚本应成功：${run.stderr ?? run.stdout}`);
  const [tgz] = (await readdir(destination)).filter(name => name.endsWith('.tgz'));
  assert.ok(tgz, '应生成 tarball');
  assert.ok((await stat(join(destination, tgz))).size > 0);
  const contents = spawnSync('tar', ['-tzf', join(destination, tgz)], {encoding: 'utf8'});
  assert.equal(contents.status, 0);
  assert.match(contents.stdout, /package\/dist\/config.html/);
  assert.match(contents.stdout, /package\/packages\/cli\/config-server.mjs/);
  assert(!contents.stdout.includes('prototypes/'));
});
