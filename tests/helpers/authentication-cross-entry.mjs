import assert from 'node:assert/strict';
import {writeFile, mkdir, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {standardFixture} from './standard-application.mjs';
import {draft} from './config-fixtures.mjs';
import {serveConfig} from '../../packages/cli/config-server.mjs';
import {createAuthenticationRunner} from '../../packages/cli/config-auth.mjs';
import {launchManagedBrowser} from '../../packages/cli/managed-browser.mjs';

const mode = process.argv[2];
const f = await standardFixture();
let service, authentication;
try {
  const shared = join(f.directory, mode === 'esm' ? 'shared.mjs' : 'shared.cjs');
  const body = `({version:'1',
    async login({page, credentials, baseUrl}) {
      await page.goto(baseUrl);
      await page.locator('[name=username]').fill(credentials.username);
      await page.locator('[name=password]').fill(credentials.password);
      await page.getByRole('button', {name:'登录', exact:true}).click();
    },
    async verify({page}) {
      await page.locator('#identity').waitFor();
      return {authenticated: true, identityMatches: true};
    }
  })`;
  const sharedSource =
    mode === 'esm' ? `export default ${body};` : "const load = require; module.exports = load('./policy.cjs');";
  await writeFile(shared, sharedSource);
  if (mode === 'commonjs') await writeFile(join(f.directory, 'policy.cjs'), `module.exports = ${body};`);
  for (const name of ['a', 'b', 'c'])
    await writeFile(
      join(f.directory, `${name}.mjs`),
      `export {default} from './shared.${mode === 'esm' ? 'mjs' : 'cjs'}';`
    );
  // Also cover a second real path spelling to the same dependency.
  await symlink(f.directory, join(f.directory, 'alias'));
  await writeFile(join(f.directory, 'alias-entry.mjs'), "export {default} from './alias/shared.mjs';");
  let launches = 0;
  authentication = createAuthenticationRunner({
    directory: f.directory,
    launchBrowser: () => {
      launches++;
      return launchManagedBrowser({channel: 'chrome'});
    }
  });
  const staticRoot = join(f.root, 'dist');
  await mkdir(staticRoot);
  await writeFile(join(staticRoot, 'config.html'), '<h1>Configuration</h1>');
  service = await serveConfig({store: f.store, authentication, staticRoot});
  const check = async module => {
    await f.store.saveProject({...(await f.store.load()).project, authentication: {type: 'module', module}});
    const response = await fetch(service.origin + '/api/test-login', {
      method: 'POST',
      headers: {'X-Atlas-Token': service.token, Origin: service.origin, 'Content-Type': 'application/json'},
      body: JSON.stringify(draft({...(await f.store.load()).roles[0], password: 'standard-private-password'}))
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await check('./a.mjs')).status, 'passed');
  if (mode === 'esm') {
    // Unchanged complete shared dependencies may be reused through a new entry.
    assert.equal((await check('./b.mjs')).status, 'passed');
    await writeFile(shared, sharedSource.replace('authenticated: true', 'authenticated: false'));
    const changed = await check('./c.mjs');
    assert.equal(changed.status, 'failed');
    assert.match(changed.message, /Authentication dependencies changed/);
    const alias = await check('./alias-entry.mjs');
    assert.equal(alias.status, 'failed');
    assert.match(alias.message, /Restart the Atlas service/);
    assert.equal(launches, 2);
    // An opaque graph cannot safely load previously cached dependencies either.
    await writeFile(
      join(f.directory, 'opaque.mjs'),
      "import {createRequire} from 'node:module'; export default createRequire(import.meta.url)('./policy.cjs');"
    );
    await writeFile(join(f.directory, 'policy.cjs'), `module.exports = ${body};`);
    const opaque = await check('./opaque.mjs');
    assert.equal(opaque.status, 'failed');
    assert.match(opaque.message, /Restart the Atlas service/);
  } else {
    await writeFile(
      join(f.directory, 'policy.cjs'),
      `module.exports = ${body.replace('authenticated: true', 'authenticated: false')};`
    );
    const changed = await check('./b.mjs');
    assert.equal(changed.status, 'failed');
    assert.match(changed.message, /Restart the Atlas service/);
    // Opaque loaders may have cached modules outside their visible graph.
    await writeFile(join(f.directory, 'apparently-independent.mjs'), `export default ${body};`);
    const next = await check('./apparently-independent.mjs');
    assert.equal(next.status, 'failed');
    assert.match(next.message, /Restart the Atlas service/);
    assert.equal(launches, 1);
  }
} finally {
  await service?.close();
  await authentication?.close();
  await f.cleanup();
}
