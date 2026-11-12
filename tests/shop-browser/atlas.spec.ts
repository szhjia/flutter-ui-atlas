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
    const output = join(directory, '.atlas/generated', size);
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
        const manifest = JSON.parse(
          await readFile(join(directory, '.atlas/generated', profile, 'manifest.json'), 'utf8')
        );
        expect(manifest.screens.filter((screen: {status: string}) => screen.status === 'captured')).toHaveLength(16);
        expect(manifest.edges.filter((edge: {status: string}) => edge.status === 'observed')).toHaveLength(21);
      }
      const successfulManifest = await readFile(join(output, 'manifest.json'), 'utf8');
      const result = JSON.parse(successfulManifest);
      expect(result.viewport).toEqual(sizes[size]);
      expect(result.screens).toHaveLength(16);
      expect(result.screens.filter((screen: {status: string}) => screen.status !== 'captured')).toEqual([]);
      expect(result.edges).toHaveLength(21);
      expect(result.edges.filter((edge: {status: string}) => edge.status !== 'observed')).toEqual([]);
      expect(result.runtimeErrors).toEqual([]);
      expect(successfulManifest).not.toMatch(/1234\.com|ws:\/\/|credentials|demoAccount|atlasSession/);
      expect(result.screens.filter((screen: {id: string}) => screen.id.startsWith('@anonymous:'))).toHaveLength(2);
      for (const role of [first, second]) {
        expect(result.screens.filter((screen: {id: string}) => screen.id.startsWith(role.id + ':'))).toHaveLength(7);
      }
      await assertShopIgnored(directory, [
        '.atlas/atlas.yaml',
        '.atlas/local/credentials.json',
        `.atlas/generated/${size}/manifest.json`,
        `.atlas/generated/${size}/${result.captureId}/0.png`
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
      await expect(page.locator('.map-card')).toHaveCount(16);
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
      await page.getByRole('button', {name: '实时操作', exact: true}).click();
      await expect(page.getByRole('status')).toContainText('已在独立 Chrome 窗口打开');
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

      await page.locator(`.react-flow__node[data-id="${second.id}:cart-empty"]`).press('Enter');
      await expect.poll(() => live.isClosed()).toBe(true);
      await liveBrowser.close();
      liveBrowser = undefined;
      await page.getByRole('button', {name: '实时操作', exact: true}).click();
      await expect(page.getByRole('status')).toContainText('已在独立 Chrome 窗口打开');
      const secondRecord = await readShopLiveRecord(directory, result.captureId);
      expect(secondRecord.screenId).toBe(`${second.id}:cart-empty`);
      expect(secondRecord.pid).not.toBe(firstRecord.pid);
      expect(await readdir(join(directory, '.atlas/local/sessions'))).toHaveLength(1);
      liveBrowser = await chromium.connectOverCDP(secondRecord.endpoint);
      const other = liveBrowser.contexts()[0].pages()[0];
      await expect(other.getByText('Account: user2', {exact: true})).toBeVisible();
      await expect(other.getByText('Your cart is empty', {exact: true})).toBeVisible();
      await other.close();
      await expect(page.getByRole('status')).toContainText('实时会话已关闭');
      await expect.poll(async () => (await readdir(join(directory, '.atlas/local/sessions'))).length).toBe(0);
      await liveBrowser.close();
      liveBrowser = undefined;

      expect(await normal.evaluate(() => JSON.stringify(localStorage))).toBe(localBefore);
      await normal.reload();
      await enableShopSemantics(normal);
      await expect(normal.getByText('Account: user1', {exact: true})).toBeVisible();
      await normal.getByRole('button', {name: 'Open cart', exact: true}).click();
      await expect(normal.getByText('Total ¥129.00', {exact: true})).toBeVisible();

      // Missing body content must fail the build and preserve the successful map, even when header checks pass.
      const configFile = join(directory, '.atlas/atlas.yaml');
      const broken = parse(await readFile(configFile, 'utf8'));
      broken.timeoutMs = 3000;
      broken.screens = broken.screens.filter((screen: {id: string}) => screen.id === 'cart-full');
      broken.screens[0].roles = ['user1'];
      broken.screens[0].ready.all = broken.screens[0].ready.all.map((ready: {text?: string}) =>
        ready.text === 'Total ¥69.00' ? {text: 'Missing cart total content'} : ready
      );
      broken.edges = [];
      await writeFile(configFile, stringify(broken));
      const failure = await runShopCli(cli, directory, ['build', '--profile', size]);
      await writeFile(info.outputPath('failed-build.log'), failure.output);
      expect(failure.code).toBe(1);
      expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(successfulManifest);
      expect(JSON.parse(await readFile(join(output, 'latest-attempt.json'), 'utf8')).status).toBe('failed');
      await page.getByRole('button', {name: '刷新采集结果', exact: true}).click();
      await expect(page.locator('.map-card')).toHaveCount(16);
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
