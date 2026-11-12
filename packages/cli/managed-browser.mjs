import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
/** 独占临时 Chrome 进程；终止操作只作用于本函数创建的 BrowserServer。 */
export async function launchManagedBrowser({channel = 'chrome', headless = true} = {}) {
  const {chromium} = await import('playwright');
  const server = await chromium.launchServer({channel, headless, args: ['--remote-debugging-port=0']});
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    const directory = server
      .process()
      .spawnargs.find(arg => arg.startsWith('--user-data-dir='))
      .slice('--user-data-dir='.length);
    const [port, endpoint] = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
    browser.atlasEndpoint = `ws://127.0.0.1:${port}${endpoint}`;
    browser.atlasPid = server.process().pid;
    const disconnect = browser.close.bind(browser);
    let stopping;
    browser.close = () => (stopping ??= server.kill().finally(() => disconnect().catch(() => {})));
    return browser;
  } catch (error) {
    await server.kill();
    throw error;
  }
}
