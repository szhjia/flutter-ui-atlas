/** Browser helpers for standalone app verification; the app needs no capture SDK. */
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
  await fillShopField(page, 'Username', account);
  await fillShopField(page, 'Password', password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  if (password === '1234.com') await page.getByRole('heading', {name: 'Home', exact: true}).waitFor();
  else await page.locator('flt-semantics').getByText('Incorrect username or password', {exact: true}).waitFor();
}

export async function navigateShop(page, tab) {
  await page
    .getByRole('tab', {name: tab, exact: true})
    .or(page.getByRole('button', {name: new RegExp(`^${tab}(?: Tab [1-3] of 3)?$`)}))
    .click();
}
