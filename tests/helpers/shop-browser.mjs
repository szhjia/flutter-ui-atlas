/** 仅供普通应用验收的浏览器操作；应用本身无需导入采集 SDK。 */
export async function enableShopSemantics(page) {
  const enable = page
    .locator('flt-semantics-placeholder')
    .and(page.getByRole('button', {name: 'Enable accessibility', exact: true}));
  const content = page.locator('flt-semantics').first();
  await content.or(enable).first().waitFor({state: 'attached'});
  if (!(await content.count())) {
    await page.locator('flutter-view flt-semantics-host').waitFor({state: 'attached'});
    await enable.dispatchEvent('click');
  }
  await page.locator('flt-semantics').first().waitFor({state: 'attached'});
}

export async function openShop(page, url) {
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await enableShopSemantics(page);
}

export async function renderedShopUpdate(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function fillShopField(page, name, value) {
  const input = page.getByRole('textbox', {name, exact: true});
  await input.focus();
  await renderedShopUpdate(page);
  await input.fill(value);
  await renderedShopUpdate(page);
}

export async function loginShop(page, account, password = '1234.com') {
  await fillShopField(page, '登录账号', account);
  await fillShopField(page, '登录密码', password);
  await page.getByRole('button', {name: '登录', exact: true}).click();
  if (password === '1234.com') await page.getByRole('heading', {name: '首页', exact: true}).waitFor();
  else await page.locator('flt-semantics').getByText('账号或密码错误', {exact: true}).waitFor();
}

export async function navigateShop(page, tab) {
  await page
    .getByRole('tab', {name: tab, exact: true})
    .or(page.getByRole('button', {name: new RegExp(`^${tab}(?: Tab [1-3] of 3)?$`)}))
    .click();
}
