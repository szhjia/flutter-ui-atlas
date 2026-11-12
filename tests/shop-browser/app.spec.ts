import {expect, test} from '@playwright/test';
import {enableShopSemantics, fillShopField, loginShop, navigateShop, openShop} from '../helpers/shop-browser.mjs';

for (const viewport of [
  {width: 393, height: 852},
  {width: 1024, height: 768}
]) {
  test(`完整应用流程与本地账户隔离 ${viewport.width}×${viewport.height}`, async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await openShop(page, '/#/cart');
    await expect(page.getByRole('heading', {name: '登录拾物', exact: true})).toBeVisible();
    await loginShop(page, 'user1', 'wrong');
    await loginShop(page, 'user1');
    await page.getByRole('button', {name: '逛逛商城', exact: true}).click();
    const names = ['轻量随行杯', '日常帆布包', '暖光小台灯', '方格记录本', '桌面小音箱', '柔软针织毯'];
    for (const name of names) {
      await page.getByRole('button', {name: `查看${name}`, exact: true}).click();
      await expect(page.getByRole('heading', {name, exact: true})).toBeVisible();
      await page.getByRole('button', {name: '返回商城', exact: true}).click();
    }
    await page.getByRole('button', {name: '查看轻量随行杯', exact: true}).click();
    await page.getByRole('button', {name: '加入购物车', exact: true}).click();
    await page.getByRole('button', {name: '查看购物车', exact: true}).click();
    await expect(page.getByText('合计 ¥69.00', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '增加轻量随行杯数量', exact: true}).click();
    await expect(page.getByText('合计 ¥138.00', {exact: true})).toBeVisible();
    await page.reload();
    await enableShopSemantics(page);
    await expect(page.getByText('合计 ¥138.00', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '减少轻量随行杯数量', exact: true}).click();
    await expect(page.getByText('合计 ¥69.00', {exact: true})).toBeVisible();
    await navigateShop(page, '我的');
    await page.getByRole('button', {name: '退出登录', exact: true}).click();
    await page.goBack();
    await expect(page.getByRole('heading', {name: '登录拾物', exact: true})).toBeVisible();
    await loginShop(page, 'user2');
    await page.getByRole('button', {name: '打开购物车', exact: true}).click();
    await expect(page.getByText('购物车还是空的', {exact: true})).toBeVisible();
    await navigateShop(page, '我的');
    await page.getByRole('button', {name: '退出登录', exact: true}).click();
    await loginShop(page, 'user1');
    await page.getByRole('button', {name: '打开购物车', exact: true}).click();
    await expect(page.getByText('合计 ¥69.00', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '删除轻量随行杯', exact: true}).click();
    await expect(page.getByText('购物车还是空的', {exact: true})).toBeVisible();
    await page.goto('/#/products/unknown');
    await expect(page.getByText('没有找到这个页面或商品', {exact: true})).toBeVisible();
    await navigateShop(page, '我的');
    await page.getByRole('button', {name: '重置演示数据', exact: true}).click();
    await page.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.getByRole('heading', {name: '我的', exact: true})).toBeVisible();
    await page.getByRole('button', {name: '重置演示数据', exact: true}).click();
    await page.getByRole('button', {name: '确认重置', exact: true}).click();
    await expect(page.getByRole('heading', {name: '登录拾物', exact: true})).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('空字段校验与键盘提交', async ({page}) => {
  await openShop(page, '/');
  await page.getByRole('button', {name: '登录', exact: true}).click();
  await expect(page.locator('flt-semantics').getByText('请输入账号', {exact: true})).toBeVisible();
  await expect(page.locator('flt-semantics').getByText('请输入密码', {exact: true})).toBeVisible();
  await fillShopField(page, '登录账号', 'user2');
  await fillShopField(page, '登录密码', '1234.com');
  await page.getByRole('textbox', {name: '登录密码', exact: true}).press('Enter');
  await expect(page.getByRole('heading', {name: '首页', exact: true})).toBeVisible();
});
