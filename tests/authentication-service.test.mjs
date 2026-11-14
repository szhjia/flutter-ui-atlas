import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {serveConfig} from '../packages/cli/config-server.mjs';
import {createAuthenticationRunner} from '../packages/cli/config-auth.mjs';
import {draft} from './helpers/config-fixtures.mjs';

test('long-lived configuration service refuses untracked authentication modules after one operation', async t => {
  const {standardFixture} = await import('./helpers/standard-application.mjs');
  const {launchManagedBrowser} = await import('../packages/cli/managed-browser.mjs');
  const f = await standardFixture();
  t.after(() => f.cleanup());
  await writeFile(join(f.directory, 'policy.cjs'), 'module.exports = {allow: true};');
  await writeFile(join(f.directory, 'bridge.cjs'), "const load = require; module.exports = load('./policy.cjs');");
  await writeFile(
    join(f.directory, 'auth.mjs'),
    `
    import policy from './bridge.cjs';
    export default {version: '1',
      async login({page, credentials, baseUrl}) {
        await page.goto(baseUrl);
        await page.locator('[name=username]').fill(credentials.username);
        await page.locator('[name=password]').fill(credentials.password);
        await page.getByRole('button', {name: '登录', exact: true}).click();
      },
      async verify({page}) {
        await page.locator('#identity').waitFor();
        return {authenticated: policy.allow, identityMatches: policy.allow};
      }
    }
  `
  );
  await f.store.saveProject({
    ...(await f.store.load()).project,
    authentication: {type: 'module', module: './auth.mjs'}
  });
  let launches = 0;
  const authentication = createAuthenticationRunner({
    directory: f.directory,
    launchBrowser: () => {
      launches++;
      return launchManagedBrowser({channel: 'chrome'});
    }
  });
  const staticRoot = join(f.root, 'dist');
  await mkdir(staticRoot);
  await writeFile(join(staticRoot, 'config.html'), '<h1>Configuration</h1>');
  const service = await serveConfig({store: f.store, authentication, staticRoot});
  t.after(() => service.close());
  const check = async () => {
    const response = await fetch(service.origin + '/api/test-login', {
      method: 'POST',
      headers: {'X-Atlas-Token': service.token, Origin: service.origin, 'Content-Type': 'application/json'},
      body: JSON.stringify(draft({...(await f.store.load()).roles[0], password: 'standard-private-password'}))
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await check()).status, 'passed');
  await writeFile(join(f.directory, 'policy.cjs'), 'module.exports = {allow: false};');
  const second = await check();
  assert.equal(second.status, 'failed');
  assert.match(second.message, /Restart the Atlas service/);
  assert.equal(launches, 1, 'reject stale authentication before opening another browser');
  // A new runner in the same process is not a module-cache reset.
  const another = createAuthenticationRunner({
    directory: f.directory,
    launchBrowser: () => {
      throw Error('Must not launch');
    }
  });
  t.after(() => another.close());
  const retry = await another.test(
    await f.store.prepareLogin(draft({...(await f.store.load()).roles[0], password: 'standard-private-password'}))
  );
  assert.equal(retry.status, 'failed');
  assert.match(retry.message, /Restart the Atlas service/);
});
