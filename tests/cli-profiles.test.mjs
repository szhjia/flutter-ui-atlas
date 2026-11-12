import test from 'node:test';
import assert from 'node:assert/strict';
import {runAtlas} from '../packages/cli/index.mjs';
test('CLI 帮助公布命名视口选项', async () => {
  const lines = [];
  const log = console.log;
  console.log = value => lines.push(value);
  try {
    assert.equal(await runAtlas(['--help']), 0);
  } finally {
    console.log = log;
  }
  assert.match(lines.join('\n'), /--profile/);
});
