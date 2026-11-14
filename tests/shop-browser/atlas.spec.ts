import {readWorkspaceManifest} from '../../packages/cli/workspace-build.mjs';
import {chromium, expect, test} from '@playwright/test';
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parse, stringify} from 'yaml';
import {enableShopSemantics, loginShop, openShop} from '../helpers/shop-browser.mjs';
import {
  assertShopPrivateFiles,
  assertShopIgnored,
  assertShopSourcesUnchanged,
  availableShopPort,
  configureShopAccounts,
  createShopProject,
  installShopCli,
  readShopLiveRecord,
  runShopCli,
  startShopCli
} from '../helpers/shop-harness.mjs';

const sizes = {phone: {width: 393, height: 852}, pad: {width: 1024, height: 768}};

for (const size of ['phone', 'pad'] as const) {
  test(`Installed CLI setup, real captures, live sessions, and preserving maps on failure ${size}`, async ({
    page,
    browser,
    baseURL
  }, info) => {
    test.setTimeout(600000);
    const cli = await installShopCli();
    const directory = await createShopProject(cli, baseURL!);
    const output = join(directory, '.atlas/generated');
    let configService: Awaited<ReturnType<typeof startShopCli>> | undefined;
    let viewer: Awaited<ReturnType<typeof startShopCli>> | undefined;
    let liveBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    const normal = await browser.newPage({viewport: sizes[size]});
    try {
      configService = await startShopCli(cli, directory, ['config', '--no-open']);
      await page.goto(configService.url);
      await configureShopAccounts(page, baseURL!);
      const config = await assertShopPrivateFiles(directory);
      const first = config.roles.find((role: {tag: string}) => role.tag === 'user1');
      const second = config.roles.find((role: {tag: string}) => role.tag === 'user2');
      expect(first.id).not.toBe('user1');
      expect(second.id).not.toBe('user2');
      await configService.close();
      configService = undefined;

      await openShop(normal, baseURL!);
      await loginShop(normal, 'user1');
      await normal.getByRole('button', {name: 'Browse shop', exact: true}).click();
      await normal.getByRole('button', {name: 'View Canvas tote', exact: true}).click();
      await normal.getByRole('button', {name: 'Add to cart', exact: true}).click();
      await expect(normal.getByLabel('Cart items: 1', {exact: true})).toBeVisible();
      const localBefore = await normal.evaluate(() => JSON.stringify(localStorage));

      const build = await runShopCli(cli, directory, size === 'phone' ? ['build'] : ['build', '--profile', size]);
      await writeFile(info.outputPath('build.log'), build.output);
      expect(build.code, build.output).toBe(0);
      for (const profile of size === 'phone' ? ['phone', 'pad'] : [size]) {
        const manifest = await readWorkspaceManifest(output, profile);
        expect(manifest.workspaces.filter((w: {id: string}) => w.id !== '@anonymous')).toHaveLength(2);
        for (const workspace of manifest.workspaces.filter((w: {id: string}) => w.id !== '@anonymous')) {
          expect(workspace.map.screens).toHaveLength(6);
          expect(workspace.map.edges).toHaveLength(8);
          expect(workspace.map.edges.every((e: {status: string}) => e.status === 'observed')).toBe(true);
        }
      }
      const successfulManifest = await readFile(join(output, 'index.json'), 'utf8');
      const bundle = await readWorkspaceManifest(output, size);
      const result = bundle.workspaces.find((w: {id: string}) => w.id === first.id).map;
      const secondMap = bundle.workspaces.find((w: {id: string}) => w.id === second.id).map;
      const doctor = await runShopCli(cli, directory, ['doctor']);
      expect(doctor.code, doctor.output).toBe(0);
      const hit = await runShopCli(cli, directory, ['build', '--profile', size]);
      expect(hit.code, hit.output).toBe(0);
      expect(hit.output).toContain('"capturedWorkspaces":0');
      expect(await readFile(join(output, 'index.json'), 'utf8')).toBe(successfulManifest);
      expect(result.viewport).toEqual(sizes[size]);
      expect(result.screens).toHaveLength(6);
      expect(result.screens.filter((screen: {status: string}) => screen.status !== 'captured')).toEqual([]);
      expect(result.edges).toHaveLength(8);
      expect(result.edges.filter((edge: {status: string}) => edge.status !== 'observed')).toEqual([]);
      expect(result.runtimeErrors).toEqual([]);
      expect(successfulManifest).not.toMatch(/1234\.com|ws:\/\/|credentials|demoAccount|atlasSession/);
      expect(result.screens.filter((screen: {id: string}) => screen.id.startsWith('@anonymous:'))).toHaveLength(1);
      expect(result.screens.filter((screen: {id: string}) => screen.id.startsWith(first.id + ':'))).toHaveLength(5);
      expect(result.screens.some((screen: {id: string}) => screen.id.startsWith(second.id + ':'))).toBe(false);
      await assertShopIgnored(directory, [
        '.atlas/atlas.yaml',
        '.atlas/local/credentials.json',
        '.atlas/generated/index.json',
        `.atlas/generated/captures/${result.captureId}/0.png`
      ]);
      await assertShopSourcesUnchanged(directory);

      viewer = await startShopCli(cli, directory, [
        'view',
        '--profile',
        size,
        '--port',
        String(await availableShopPort())
      ]);
      await page.setViewportSize({width: 1600, height: 1000});
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(viewer.url);
      await expect(page.locator('.map-card')).toHaveCount(6);
      await expect(page.locator('.map-card img').first()).toHaveCSS('object-fit', 'contain');
      await expect
        .poll(() =>
          page
            .locator('.map-card img')
            .evaluateAll(images =>
              images.every(
                image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
              )
            )
        )
        .toBe(true);
      await page.screenshot({path: info.outputPath(`${size}-canvas.png`)});
      await page.locator(`.react-flow__node[data-id="${first.id}:detail"]`).press('Enter');
      await page.getByRole('button', {name: 'Open live session', exact: true}).click();
      await expect(page.getByRole('status')).toContainText('Opened in a separate Chrome window');
      expect(await page.locator('iframe').count()).toBe(0);
      const firstRecord = await readShopLiveRecord(directory, result.captureId);
      await assertShopIgnored(
        directory,
        (await readdir(join(directory, '.atlas/local/sessions'))).map(name => '.atlas/local/sessions/' + name)
      );
      expect(firstRecord.screenId).toBe(`${first.id}:detail`);
      expect(firstRecord.viewport).toEqual(sizes[size]);
      // Read the endpoint only from this project’s private 0600 session file, never from a page, manifest, or log.
      liveBrowser = await chromium.connectOverCDP(firstRecord.endpoint);
      const live = liveBrowser.contexts()[0].pages()[0];
      expect(await live.evaluate(() => ({width: innerWidth, height: innerHeight}))).toEqual(sizes[size]);
      await expect(live.getByText('Account: user1', {exact: true})).toBeVisible();
      await expect(live.getByRole('heading', {name: 'Travel cup', exact: true})).toBeVisible();
      await live.getByRole('button', {name: 'Add to cart', exact: true}).click();
      await live.getByRole('button', {name: 'View cart', exact: true}).click();
      await expect(live.getByText('Total ¥69.00', {exact: true})).toBeVisible();
      await live.screenshot({path: info.outputPath(`${size}-live.png`)});

      await page.getByRole('combobox', {name: 'Account', exact: true}).click();
      await page.getByRole('option', {name: second.name, exact: true}).click();
      await expect(page.locator('.map-card')).toHaveCount(6);
      await expect(page.locator('.map-card img').first()).toHaveCSS('object-fit', 'contain');
      await page.locator(`.react-flow__node[data-id="${second.id}:cart"]`).press('Enter');
      await expect.poll(() => live.isClosed()).toBe(true);
      await liveBrowser.close();
      liveBrowser = undefined;
      await page.getByRole('button', {name: 'Open live session', exact: true}).click();
      await expect(page.getByRole('status')).toContainText('Opened in a separate Chrome window');
      const secondRecord = await readShopLiveRecord(directory, secondMap.captureId);
      expect(secondRecord.screenId).toBe(`${second.id}:cart`);
      expect(secondRecord.pid).not.toBe(firstRecord.pid);
      expect(await readdir(join(directory, '.atlas/local/sessions'))).toHaveLength(1);
      liveBrowser = await chromium.connectOverCDP(secondRecord.endpoint);
      const other = liveBrowser.contexts()[0].pages()[0];
      await expect(other.getByText('Account: user2', {exact: true})).toBeVisible();
      await expect(other.getByText('Your cart is empty', {exact: true})).toBeVisible();
      await other.close();
      await expect(page.getByRole('status')).toContainText('Live session closed');
      await expect.poll(async () => (await readdir(join(directory, '.atlas/local/sessions'))).length).toBe(0);
      await liveBrowser.close();
      liveBrowser = undefined;

      expect(await normal.evaluate(() => JSON.stringify(localStorage))).toBe(localBefore);
      await normal.reload();
      await enableShopSemantics(normal);
      await expect(normal.getByText('Account: user1', {exact: true})).toBeVisible();
      await normal.getByRole('button', {name: 'Open cart', exact: true}).click();
      await expect(normal.getByText('Total ¥129.00', {exact: true})).toBeVisible();

      const forced = await runShopCli(cli, directory, ['build', '--profile', size, '--force']);
      expect(forced.code, forced.output).toBe(0);
      expect((await readWorkspaceManifest(output, size)).captureId).not.toBe(bundle.captureId);
      const forcedIndex = await readFile(join(output, 'index.json'), 'utf8');

      // Missing body content must fail the build and preserve the successful map, even when header checks pass.
      const configFile = join(directory, '.atlas/atlas.yaml');
      const broken = parse(await readFile(configFile, 'utf8'));
      broken.timeoutMs = 3000;
      broken.screens = broken.screens.filter((screen: {id: string}) => screen.id === 'cart');
      broken.screens[0].roles = ['user1'];
      broken.screens[0].ready.all.push({text: 'Missing cart total content'});
      broken.edges = [];
      await writeFile(configFile, stringify(broken));
      const failure = await runShopCli(cli, directory, ['build', '--profile', size]);
      await writeFile(info.outputPath('failed-build.log'), failure.output);
      expect(failure.code).toBe(1);
      expect(await readFile(join(output, 'index.json'), 'utf8')).toBe(forcedIndex);
      expect(JSON.parse(await readFile(join(output, 'latest-attempt.json'), 'utf8')).status).toBe('failed');
      await page.getByRole('button', {name: 'Refresh captures', exact: true}).click();
      await expect(page.locator('.map-card')).toHaveCount(6);
      await expect(page.locator('.map-card img').first()).toHaveCSS('object-fit', 'contain');
      expect(errors).toEqual([]);
      const sourceEvidence = await assertShopSourcesUnchanged(directory);
      await writeFile(info.outputPath('source-unchanged.json'), JSON.stringify(sourceEvidence, null, 2));

      const evidence = resolve(`.runtime/shop-verification/standard-${size}`);
      await mkdir(evidence, {recursive: true});
      await cp(output, evidence, {recursive: true});
    } finally {
      await liveBrowser?.close().catch(() => {});
      await viewer?.close();
      await configService?.close();
      await normal.close();
      await rm(directory, {recursive: true, force: true});
    }
  });
}

test('Installed CLI configuration saves two accounts and a wrong password, restores after restart, and deletes accounts', async ({
  baseURL
}, info) => {
  test.setTimeout(300000);
  const cli = await installShopCli();
  const result = await runShopCli(resolve('examples/verify-config.mjs'), resolve('.'), [baseURL!, cli]);
  await writeFile(info.outputPath('config.log'), result.output);
  expect(result.code, result.output).toBe(0);
  expect(result.output).toMatch(/"status":\s*"passed"/);
});
