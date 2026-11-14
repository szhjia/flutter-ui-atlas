import assert from 'node:assert/strict';
import {mkdir, writeFile, symlink, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {standardFixture} from './standard-application.mjs';
import {draft} from './config-fixtures.mjs';
import {createAuthenticationAdapter, createAuthenticationRunner} from '../../packages/cli/config-auth.mjs';
import {launchManagedBrowser} from '../../packages/cli/managed-browser.mjs';
import {createProjectAdapter} from '../../packages/cli/project-runtime.mjs';
import {serveConfig} from '../../packages/cli/config-server.mjs';

const mode = process.argv[2];
const f = await standardFixture();
let service, browser, runner;
try {
  const adapterSource = allow => `export default {version:'1',
    async login({page, credentials, baseUrl}) {
      await page.goto(baseUrl);
      await page.locator('[name=username]').fill(credentials.username);
      await page.locator('[name=password]').fill(credentials.password);
      await page.getByRole('button', {name:'登录', exact:true}).click();
    },
    async verify({page}) {await page.locator('#identity').waitFor(); return {authenticated:${allow},identityMatches:${allow}};}
  };`;
  for (const [directory, allow] of [
    ['one', true],
    ['two', false]
  ]) {
    await mkdir(join(f.directory, directory));
    await writeFile(join(f.directory, directory, 'helper.mjs'), adapterSource(allow));
  }
  const fileLink = mode === 'file-link';
  const link = join(f.directory, fileLink ? 'current.mjs' : 'current');
  const target = directory => (fileLink ? join(f.directory, directory, 'helper.mjs') : join(f.directory, directory));
  await symlink(target('one'), link);
  const entry = `export {default} from '${fileLink ? './current.mjs' : './current/helper.mjs'}';`;
  for (const name of ['a', 'b']) await writeFile(join(f.directory, name + '.mjs'), entry);
  await f.store.saveProject({
    ...(await f.store.load()).project,
    authentication: {type: 'module', module: mode === 'entry-parent' ? './current/helper.mjs' : './a.mjs'}
  });
  const retarget = async () => {
    await unlink(link);
    await symlink(target('two'), link);
  };
  if (mode === 'same-scope') {
    const snapshot = await f.store.readBuildSnapshot();
    const adapter = createProjectAdapter({snapshot, profile: {name: null, viewport: {width: 393, height: 852}}});
    const screen = (await adapter.catalog()).screens[0];
    browser = await launchManagedBrowser({channel: 'chrome'});
    const session = await adapter.open({browser, screen});
    await session.ready(screen);
    await session.close();
    await retarget();
    await assert.rejects(
      createAuthenticationAdapter({directory: f.directory, project: snapshot.project, scope: snapshot}),
      /dependency resolution changed/
    );
  } else {
    let launches = 0;
    runner = createAuthenticationRunner({
      directory: f.directory,
      launchBrowser: () => {
        launches++;
        return launchManagedBrowser({channel: 'chrome'});
      }
    });
    const staticRoot = join(f.root, 'dist');
    await mkdir(staticRoot);
    await writeFile(join(staticRoot, 'config.html'), '<h1>Configuration</h1>');
    service = await serveConfig({store: f.store, authentication: runner, staticRoot});
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
    await retarget();
    if (mode === 'cross-entry')
      await f.store.saveProject({
        ...(await f.store.load()).project,
        authentication: {type: 'module', module: './b.mjs'}
      });
    const result = await check();
    assert.equal(result.status, 'failed');
    assert.match(result.message, /dependency resolution changed/);
    assert.equal(launches, 1);
  }
} finally {
  await service?.close();
  await runner?.close();
  await browser?.close();
  await f.cleanup();
}
