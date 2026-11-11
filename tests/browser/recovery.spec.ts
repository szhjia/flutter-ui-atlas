import {expect, test} from '@playwright/test';

const entry = '/tests/browser/fixtures/recovery.html';
const key = 'flutter-ui-atlas:layout:v1:recovery:a';

test('切换来源失败不会展示旧图或写入新布局，重试成功后只保存新来源', async ({page}) => {
  await page.goto(entry);
  await expect(page.locator('.map-card')).toHaveCount(1);
  await page.locator('.map-card').click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.getByRole('button', {name: '切换来源 B'}).click();
  await expect(page.getByRole('alert')).toContainText('来源 B 暂时不可用');
  await expect(page.locator('.map-card')).toHaveCount(0);
  await expect(page.getByRole('complementary')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('flutter-ui-atlas:layout:v1:recovery:b'))).toBeNull();
  await page.getByRole('button', {name: '准备来源 B'}).click();
  await page.getByRole('button', {name: '重新加载'}).click();
  await expect(page.locator('.map-card')).toContainText('来源 B 页面');
  expect(
    await page.evaluate(() =>
      Object.keys(JSON.parse(localStorage.getItem('flutter-ui-atlas:layout:v1:recovery:b')!).nodes)
    )
  ).toEqual(['b-page']);
});

test('跨窗口损坏布局后可实际操作恢复入口', async ({page, context}) => {
  await page.goto(entry);
  await expect(page.locator('.map-card')).toHaveCount(1);
  const other = await context.newPage();
  await other.goto(entry);
  await expect(other.locator('.map-card')).toHaveCount(1);
  await other.evaluate(storage => localStorage.setItem(storage, '{bad'), key);
  await page.getByRole('button', {name: '载入外部布局'}).click();
  await expect(page.getByRole('button', {name: '丢弃损坏布局'})).toBeVisible();
  expect(await page.evaluate(storage => localStorage.getItem(storage), key)).toBe('{bad');
  await page.getByRole('button', {name: '丢弃损坏布局'}).click();
  await expect(page.getByRole('button', {name: '丢弃损坏布局'})).toHaveCount(0);
  expect(await page.evaluate(storage => JSON.parse(localStorage.getItem(storage)!).schemaVersion, key)).toBe(1);
});

test('丢弃后存储配额失败仍显示未保存诊断', async ({page}) => {
  await page.addInitScript(storage => {
    localStorage.setItem(storage, '{bad');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === storage) throw new DOMException('存储已满', 'QuotaExceededError');
      original.call(this, name, value);
    };
  }, key);
  await page.goto(entry);
  await page.getByRole('button', {name: '丢弃损坏布局'}).click();
  await expect(page.getByRole('status')).toContainText('布局未保存');
  expect(await page.evaluate(storage => localStorage.getItem(storage), key)).toBeNull();
  await expect(page.locator('.map-card')).toHaveCount(1);
});
