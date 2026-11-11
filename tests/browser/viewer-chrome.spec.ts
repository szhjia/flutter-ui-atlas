import {expect, test} from '@playwright/test';
import {graph} from './fixtures/graphs';

for (const viewport of [{width: 1305, height: 954}, {width: 1024, height: 768}]) {
  test(`独立 Viewer 品牌和画布控件 ${viewport.width}×${viewport.height}`, async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);

    const title = '示例应用品牌名称'.repeat(15);
    let logoUrl = '/viewer-fixture/brand.svg';
    let logoAvailable = true;
    await page.route('**/viewer-fixture/brand.svg', route => logoAvailable
      ? route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="blue"/></svg>'})
      : route.fulfill({status: 404}));
    await page.route(url => url.pathname === '/', async route => {
      const response = await route.fetch();
      const config = {artifactPaths: ['/viewer-fixture'], layoutKey: 'viewer-chrome-test', shell: {
        title, logoUrl, logoText: '示', subtitle: '旧配置的副标题',
      }};
      const body = (await response.text()).replace('id="atlas-config"></script>', `id="atlas-config">${JSON.stringify(config)}</script>`);
      await route.fulfill({response, body});
    });
    const map = graph(4);
    map.screens.forEach((screen, index) => { screen.group = index < 2 ? '入口' : '功能页面'; });
    map.edges = map.edges.slice(0, 3);
    await page.route('**/viewer-fixture/manifest.json', route => route.fulfill({json: map}));
    await page.route('**/viewer-fixture/latest-attempt.json', route => route.fulfill({status: 404}));
    await page.goto('/');

    const header = page.locator('.map-topbar');
    const heading = header.getByRole('heading', {name: title, exact: true});
    await expect(heading).toHaveAttribute('title', title);
    await expect(header).not.toContainText('旧配置的副标题');
    await expect.poll(() => heading.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    expect((await header.boundingBox())?.height).toBe(48);
    const logo = header.locator('.map-logo');
    expect(await logo.boundingBox()).toMatchObject({width: 18, height: 18});
    await expect.poll(() => logo.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(32);

    const zoom = page.locator('.react-flow__controls');
    const legend = page.locator('.map-legend');
    const controlBounds = (await zoom.boundingBox())!;
    const legendBounds = (await legend.boundingBox())!;
    const buttons = await zoom.getByRole('button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y));
    expect(buttons).toHaveLength(3);
    expect(new Set(buttons).size).toBe(1);
    if (viewport.width === 1024) expect(legendBounds.y + legendBounds.height).toBeLessThanOrEqual(controlBounds.y);
    else expect(legendBounds.x).toBeGreaterThan(controlBounds.x + controlBounds.width);

    const node = page.locator('.react-flow__node[data-id="n0"]');
    await node.press('Enter');
    const detail = page.getByRole('complementary');
    await expect(detail.getByRole('heading', {name: '页面 0', exact: true})).toBeVisible();
    const collapse = page.getByRole('button', {name: '收起详情'});
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(collapse).toHaveAttribute('aria-controls', (await detail.getAttribute('id'))!);
    await expect(page.locator('.map-toolbar-actions > button').last()).toHaveAccessibleName('收起详情');
    await collapse.click();
    await expect(detail).toHaveCount(0);
    await page.getByRole('button', {name: '展开详情'}).click();
    await expect(detail.getByRole('heading', {name: '页面 0', exact: true})).toBeVisible();

    const toggle = page.getByRole('checkbox', {name: '显示连线'});
    const edges = page.locator('.react-flow__edge');
    const labels = page.locator('.atlas-edge-label');
    await expect(toggle).toBeChecked();
    await expect(edges).toHaveCount(3);
    await expect(labels.first()).toBeAttached();
    await toggle.uncheck();
    await expect(edges).toHaveCount(0);
    await expect(labels).toHaveCount(0);
    await expect(detail.getByRole('heading', {name: '页面关系 · 1'})).toBeVisible();

    const groups = page.getByRole('combobox', {name: /功能分组：/});
    expect(await groups.evaluate(element => {
      const arrow = element.querySelector('svg')!;
      return element.getBoundingClientRect().right - arrow.getBoundingClientRect().right - parseFloat(getComputedStyle(element).borderRightWidth);
    })).toBeCloseTo(12);
    const position = await node.getAttribute('style');
    await groups.press('ArrowDown');
    await expect(groups).toHaveAttribute('aria-expanded', 'true');
    await groups.press('ArrowDown');
    await groups.press('Escape');
    await expect(groups).toHaveAttribute('aria-expanded', 'false');
    await expect(node).toHaveAttribute('style', position!);
    await groups.press('Enter');
    await groups.press('End');
    await groups.press('Space');
    await expect(groups).toHaveAccessibleName('功能分组：功能页面');
    await expect(page.locator('.map-card')).toHaveCount(2);
    await toggle.check();
    await expect(edges).toHaveCount(1);
    await groups.click();
    await expect(page.getByRole('option', {name: '功能页面'})).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('option', {name: '全部功能'}).click();
    await expect(page.locator('.map-card')).toHaveCount(4);
    await groups.click();
    await groups.press('Tab');
    await expect(page.getByRole('textbox', {name: '搜索页面'})).toBeFocused();

    logoAvailable = false;
    await page.reload();
    await expect(logo).toHaveText('示');
    logoUrl = '//example.com/logo.png';
    await page.reload();
    await expect(logo).toHaveText('示');
    await expect(logo.locator('img')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
