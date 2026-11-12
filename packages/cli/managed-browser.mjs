/** 独占临时 Chrome 进程；终止操作只作用于本函数创建的 BrowserServer。 */
export async function launchManagedBrowser({channel = 'chrome', headless = true} = {}) {
  const {chromium} = await import('playwright');
  const server = await chromium.launchServer({channel, headless});
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    const disconnect = browser.close.bind(browser);
    let stopping;
    browser.close = () => stopping ??= server.kill().finally(() => disconnect().catch(() => {}));
    return browser;
  } catch (error) { await server.kill(); throw error; }
}
