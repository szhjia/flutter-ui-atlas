import {expect, test, type Page} from '@playwright/test';
import {graph} from './fixtures/graphs';

function englishMap() {
  const map = graph(3);
  map.theme = 'Default theme';
  map.scope = 'Demo screen states and navigation';
  map.screens = map.screens.map((screen, index) => ({
    ...screen,
    role: 'Reader',
    title: ['Home', 'Settings', 'Cart'][index],
    group: index === 2 ? 'Checkout' : 'Main',
    state: 'Default',
    status: ['captured', 'pending', 'failed'][index] as 'captured' | 'pending' | 'failed',
    image:
      index === 0
        ? 'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="393" height="852"><text x="20" y="40">Home</text></svg>'
          )
        : undefined,
    error: index === 1 ? 'Waiting for content' : index === 2 ? 'Content did not become ready' : undefined
  }));
  map.edges = map.edges.slice(0, 2).map((edge, index) => ({
    ...edge,
    action: index === 0 ? 'Open settings' : 'Open cart'
  }));
  return map;
}

async function serveMap(page: Page, map: ReturnType<typeof graph>) {
  await page.route('**/generated/manifest.json', route => route.fulfill({json: map}));
  await page.route('**/generated/latest-attempt.json', route => route.fulfill({status: 404}));
}

async function expectEnglishTemplate(page: Page) {
  await expect(page.locator('body')).not.toContainText(/[\p{Script=Han}\u3000-\u303f\uff01-\uff65]/u);
  const labels = await page
    .locator('[aria-label], [alt], [title]')
    .evaluateAll(elements =>
      elements.flatMap(element => ['aria-label', 'alt', 'title'].map(name => element.getAttribute(name) ?? ''))
    );
  expect(labels.join('\n')).not.toMatch(/[\p{Script=Han}\u3000-\u303f\uff01-\uff65]/u);
}

test('默认画布、卡片状态、筛选、详情和无障碍文案均为英文', async ({page}) => {
  await serveMap(page, englishMap());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.map-card')).toHaveCount(3);
  await expect(page.getByRole('combobox', {name: 'Account', exact: true})).toBeVisible();
  await expect(page.locator('.map-card').filter({hasText: 'Settings'})).toContainText('Pending');
  await expect(page.locator('.map-card').filter({hasText: 'Cart'})).toContainText('Capture failed');
  await expectEnglishTemplate(page);

  await page.locator('.react-flow__node[data-id="n0"]').press('Enter');
  const detail = page.getByRole('complementary');
  await expect(detail.getByRole('heading', {name: 'Home', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Open live session', exact: true}).click();
  await expect(detail.getByRole('alert')).toHaveText('No live preview URL is configured for this screen.');
  await expectEnglishTemplate(page);
  await page.getByRole('button', {name: 'Arrange visible screens', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Confirm layout arrangement'})).toBeVisible();
  await expectEnglishTemplate(page);
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.keyboard.press('Escape');

  await page.getByRole('combobox', {name: 'Feature group: All features'}).click();
  await page.getByRole('option', {name: 'Checkout', exact: true}).click();
  await expect(page.locator('.map-card')).toHaveCount(1);
  await expect(page.locator('.map-card')).toContainText('Cart');
  await expectEnglishTemplate(page);
});

test('没有采集结果时使用英文空态及重新加载入口', async ({page}) => {
  await page.route('**/generated/*.json', route => route.fulfill({status: 404}));
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('No captures yet. Run the capture command first.');
  await expect(page.getByRole('button', {name: 'Reload', exact: true})).toBeVisible();
  await expectEnglishTemplate(page);
});

test('入口配置损坏时使用英文错误和恢复入口', async ({page}) => {
  await page.route(
    url => url.pathname === '/',
    async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('id="atlas-config"></script>', 'id="atlas-config">{bad</script>');
      await route.fulfill({response, body});
    }
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not parse canvas configuration');
  await expect(page.getByRole('button', {name: 'Reload', exact: true})).toBeVisible();
  await expectEnglishTemplate(page);
});

test('应用提供的中文页面、账户、分组和状态保持原文', async ({page}) => {
  const map = englishMap();
  map.theme = '纸色';
  Object.assign(map.screens[0], {title: '我的书架', role: '读者甲', group: '阅读', state: '有未读书籍'});
  await serveMap(page, map);
  await page.goto('/');
  await expect(page.locator('.map-card').first()).toContainText('我的书架');
  await page.locator('.map-card h2').first().click();
  await expect(page.locator('aside, .map-inspector').first()).toContainText('有未读书籍');
  await page.getByRole('combobox', {name: 'Account', exact: true}).click();
  await expect(page.getByRole('option', {name: '读者甲', exact: true})).toBeVisible();
  await expect(page.locator('.map-status')).toContainText('纸色');
  await page.getByRole('option', {name: '读者甲', exact: true}).click();
  await expect(page.getByRole('combobox', {name: 'Account', exact: true})).toContainText('读者甲');
  await expect(page.locator('.map-card')).toHaveCount(1);
  await page.getByRole('combobox', {name: /Feature group: /}).click();
  await expect(page.getByRole('option', {name: '阅读', exact: true})).toBeVisible();
});
