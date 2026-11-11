import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const viewerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'viewer');

test('viewer 包 exports 的每个出口都指向真实文件（含新增 ./config）', async () => {
  const pkg = JSON.parse(await readFile(join(viewerDir, 'package.json'), 'utf8'));
  const entries = Object.entries(pkg.exports);
  assert.ok(entries.length >= 3, '应至少有 .、./model、./config 三个出口');
  for (const [name, target] of entries) {
    const file = join(viewerDir, String(target));
    await assert.doesNotReject(readFile(file), `出口 ${name} 指向的文件应存在：${target}`);
  }
  assert.equal(pkg.exports['.'], './src/AppMap.tsx', '主出口应锚定 AppMap');
  assert.equal(pkg.exports['./model'], './src/model.ts', 'model 出口应锚定');
  assert.equal(pkg.exports['./config'], './src/config.ts', 'P1-6：config 助手应可经包名导入');
});
