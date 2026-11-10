import {expect, test} from '@playwright/test';
import {graph} from './fixtures/graphs';

test('首次失败显示报告，有旧图时保留页面，恢复后清除提示', async ({page}) => {
  let manifest: ReturnType<typeof graph> | null = null;
  let attempt = {
    captureId: 'failed-1', status: 'failed', error: '目录不能为空',
    report: '/generated/failed-1/attempt.json',
  };
  await page.route('**/generated/manifest.json', route =>
    manifest ? route.fulfill({json: manifest}) : route.fulfill({status: 404}));
  await page.route('**/generated/latest-attempt.json', route => route.fulfill({json: attempt}));

  await page.goto('/');
  const notice = page.getByRole('status').filter({hasText: '最近采集失败'});
  await expect(notice).toContainText('目录不能为空');
  await expect(notice.getByRole('link')).toHaveAttribute('href', attempt.report);
  await expect(page.locator('.map-card')).toHaveCount(0);

  manifest = graph(8);
  await page.getByRole('button', {name: '重新加载'}).click();
  await expect(notice).toContainText('当前显示上一次成功结果');
  await expect(page.locator('.map-card')).toHaveCount(8);

  attempt = {...attempt, captureId: 'fixture-2', status: 'passed', error: ''};
  manifest = {...manifest, captureId: attempt.captureId};
  await page.getByRole('button', {name: '刷新采集结果'}).click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('.map-card')).toHaveCount(8);
});
