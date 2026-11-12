import {expect, test} from '@playwright/test';
import {enableShopSemantics, fillShopField, loginShop, navigateShop, openShop} from '../helpers/shop-browser.mjs';

for (const viewport of [
  {width: 393, height: 852},
  {width: 1024, height: 768}
]) {
  test(`Full app flow and local account isolation ${viewport.width}×${viewport.height}`, async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await openShop(page, '/#/cart');
    await expect(page.getByRole('heading', {name: 'Sign in to Shiwu', exact: true})).toBeVisible();
    await loginShop(page, 'user1', 'wrong');
    await loginShop(page, 'user1');
    await page.getByRole('button', {name: 'Browse shop', exact: true}).click();
    const names = ['Travel cup', 'Canvas tote', 'Desk lamp', 'Grid notebook', 'Desk speaker', 'Knit blanket'];
    for (const name of names) {
      await page.getByRole('button', {name: `View ${name}`, exact: true}).click();
      await expect(page.getByRole('heading', {name, exact: true})).toBeVisible();
      await page.getByRole('button', {name: 'Back to shop', exact: true}).click();
    }
    await page.getByRole('button', {name: 'View Travel cup', exact: true}).click();
    await page.getByRole('button', {name: 'Add to cart', exact: true}).click();
    await page.getByRole('button', {name: 'View cart', exact: true}).click();
    await expect(page.getByText('Total ¥69.00', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Increase Travel cup quantity', exact: true}).click();
    await expect(page.getByText('Total ¥138.00', {exact: true})).toBeVisible();
    await page.reload();
    await enableShopSemantics(page);
    await expect(page.getByText('Total ¥138.00', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Decrease Travel cup quantity', exact: true}).click();
    await expect(page.getByText('Total ¥69.00', {exact: true})).toBeVisible();
    await navigateShop(page, 'Profile');
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    await page.goBack();
    await expect(page.getByRole('heading', {name: 'Sign in to Shiwu', exact: true})).toBeVisible();
    await loginShop(page, 'user2');
    await page.getByRole('button', {name: 'Open cart', exact: true}).click();
    await expect(page.getByText('Your cart is empty', {exact: true})).toBeVisible();
    await navigateShop(page, 'Profile');
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    await loginShop(page, 'user1');
    await page.getByRole('button', {name: 'Open cart', exact: true}).click();
    await expect(page.getByText('Total ¥69.00', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Remove Travel cup', exact: true}).click();
    await expect(page.getByText('Your cart is empty', {exact: true})).toBeVisible();
    await page.goto('/#/products/unknown');
    await expect(page.getByText('Page or product not found', {exact: true})).toBeVisible();
    await navigateShop(page, 'Profile');
    await page.getByRole('button', {name: 'Reset demo data', exact: true}).click();
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Profile', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Reset demo data', exact: true}).click();
    await page.getByRole('button', {name: 'Reset', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Sign in to Shiwu', exact: true})).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('Empty-field validation and keyboard submission', async ({page}) => {
  await openShop(page, '/');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.locator('flt-semantics').getByText('Enter your username', {exact: true})).toBeVisible();
  await expect(page.locator('flt-semantics').getByText('Enter your password', {exact: true})).toBeVisible();
  await fillShopField(page, 'Username', 'user2');
  await fillShopField(page, 'Password', '1234.com');
  await page.getByRole('textbox', {name: 'Password', exact: true}).press('Enter');
  await expect(page.getByRole('heading', {name: 'Home', exact: true})).toBeVisible();
});
