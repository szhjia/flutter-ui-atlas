import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnose} from '../packages/cli/doctor.mjs';
test('doctor diagnoses browser absence without downloading or leaking raw diagnostics', async () => {
  const result = await diagnose({
    launchBrowser: async () => {
      throw Error('secret detail');
    }
  });
  assert.equal(result.ok, false);
  const browser = result.checks.find(c => c.name === 'browser');
  assert.equal(browser.ok, false);
  assert.match(browser.remedy, /Install Google Chrome/);
  assert.ok(!JSON.stringify(result).includes('secret detail'));
});
test('doctor closes its own browser context', async () => {
  const events = [];
  await diagnose({
    launchBrowser: async () => ({
      newContext: async () => ({close: async () => events.push('context')}),
      close: async () => events.push('browser')
    })
  });
  assert.deepEqual(events, ['context', 'browser']);
});

test('doctor rejects malformed identity and output outside the private directory', async t => {
  const {mkdtemp, mkdir, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'atlas-doctor-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const directory = join(root, '.atlas');
  await mkdir(directory);
  await writeFile(join(directory, 'identity.json'), 'broken');
  await writeFile(join(root, 'pubspec.yaml'), 'name: demo');
  const result = await diagnose({
    directory,
    config: {baseUrl: 'http://127.0.0.1:1', output: '../../outside'},
    launchBrowser: async () => ({newContext: async () => ({close: async () => {}}), close: async () => {}})
  });
  assert.equal(result.checks.find(c => c.name === 'identity').ok, false);
  assert.equal(result.checks.find(c => c.name === 'output').ok, false);
});
