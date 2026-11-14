import {test, expect} from '@playwright/test';
import {graph} from './fixtures/graphs';

test('v2 page names, hidden anchors, open arrows and polled input freshness', async ({page}) => {
  const map = graph(2);
  Object.assign(map, {
    schemaVersion: 2,
    applicationId: 'app',
    profileId: '@default',
    accountId: 'account',
    revisionId: 'revision',
    configurationChanged: false,
    reused: true
  });
  map.screens = map.screens.map((s, i) => ({...s, accountId: 'account', pageName: i ? 'ProfilePage' : 'LoginPage'}));
  let changed = false;
  await page.route('**/workspace-fixture/manifest.json', route => route.fulfill({json: map}));
  await page.route('**/workspace-fixture/latest-attempt.json', route => route.fulfill({status: 404}));
  await page.route('**/__atlas/workspaces', route =>
    route.fulfill({json: {workspaces: [{id: 'account', revisionId: 'revision', configurationChanged: changed}]}})
  );
  await page.route(
    url => url.pathname === '/',
    async route => {
      const response = await route.fetch();
      const config = {artifactPaths: ['/workspace-fixture'], workspaceStatusUrl: '/__atlas/workspaces'};
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          'id="atlas-config"></script>',
          `id="atlas-config">${JSON.stringify(config)}</script>`
        )
      });
    }
  );
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.map-card')).toHaveCount(2);
  await expect(page.locator('.map-card').first()).toContainText('LoginPage');
  await expect(page.locator('.map-card').first()).toContainText('/0');
  await expect(page.locator('.map-status')).toContainText('Reused capture');
  await expect(page.locator('.map-status')).toContainText('Inputs unchanged (runtime not verified)');
  expect(
    await page
      .locator('.react-flow__handle')
      .evaluateAll(nodes => nodes.every(n => getComputedStyle(n).opacity === '0'))
  ).toBe(true);
  const markers = await page.locator('marker polyline').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).fill));
  expect(markers.length).toBeGreaterThan(0);
  expect(markers.every(fill => fill === 'none')).toBe(true);
  changed = true;
  await page.clock.fastForward(31000);
  await expect(page.locator('.map-status')).toContainText('Inputs changed; capture again');
  await expect(page.locator('.map-status')).not.toContainText('Source unchanged');
});
