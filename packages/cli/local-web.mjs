import {webUrl} from '../capture/declarative.mjs';
import {assertLoopback} from '../capture/web-boundary.mjs';

const readyTimeout = 15000;

/** entryMode 配置路径经 allowRemote 转发 allowRemoteUrls；--url 隐式路径保持严格回环。 */
export function localWebDiscovery(value, readyText, {allowRemote = false, label = '--url'} = {}) {
  const address = webUrl(value);
  assertLoopback(address, {
    allowRemote,
    message:
      label === '--url'
        ? '--url 必须是本地 Flutter Web 开发服务的回环地址。'
        : `${label} 必须是本地回环地址；如需访问局域网或远程开发服务，在配置中设置 allowRemoteUrls: true。`
  });
  const route = address.hash.startsWith('#/') ? address.hash.slice(1).split('?')[0] : address.pathname;
  const screen = {
    id: 'entry',
    role: 'Default',
    group: 'Screens',
    state: 'Default',
    title: readyText ?? 'Entry screen',
    entry: address.href,
    route,
    direct: true,
    discoverySource: 'CLI entry URL'
  };

  return {
    candidates: async () => [screen],
    requireCapture: Boolean(readyText),
    async open({browser, viewport}) {
      const context = await browser.newContext({viewport, serviceWorkers: 'block'});
      try {
        const page = await context.newPage();
        await page.addInitScript(() => {
          window.addEventListener(
            'flutter-first-frame',
            () => {
              window.__atlasFlutterFirstFrame = true;
            },
            {once: true}
          );
        });
        await page.route('**/*', async route => {
          const request = route.request();
          if (request.isNavigationRequest() && new URL(request.url()).origin !== address.origin) {
            await route.abort();
          } else {
            await route.continue();
          }
        });
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        const response = await page.goto(address.href, {waitUntil: 'domcontentloaded', timeout: readyTimeout});
        if (!response?.ok()) throw Error(`开发服务未返回可用页面：HTTP ${response?.status() ?? '未知'}`);
        if (page.url() !== address.href) throw Error(`入口被重定向：期望 ${address.href}，实际 ${page.url()}`);
        const content = readyText && page.getByText(readyText, {exact: true}).filter({visible: true}).first();
        if (content) {
          const enable = page
            .locator('flt-semantics-placeholder')
            .and(page.getByRole('button', {name: 'Enable accessibility', exact: true}));
          const deadline = Date.now() + readyTimeout;
          try {
            await content.or(enable).first().waitFor({state: 'visible', timeout: readyTimeout});
            if (!(await content.isVisible()) && (await enable.isVisible())) {
              // 引擎会先创建无障碍入口，再装载 Flutter 视图和语义树。
              await page.waitForFunction(
                () => window.__atlasFlutterFirstFrame || document.querySelector('flutter-view flt-semantics-host'),
                null,
                {timeout: Math.max(1, deadline - Date.now())}
              );
              await enable.dispatchEvent('click', {}, {timeout: Math.max(1, deadline - Date.now())});
            }
            await content.waitFor({state: 'visible', timeout: Math.max(1, deadline - Date.now())});
          } catch (error) {
            if (error.name !== 'TimeoutError') throw error;
            const detail = errors.length ? ` 浏览器异常：${errors[0]}` : '';
            throw Error(`入口未就绪：未看到「${readyText}」。${detail}`, {cause: error});
          }
        }
        return {
          page,
          errors,
          close: () => context.close(),
          observe: async () =>
            content && page.url() === address.href && (await content.isVisible()) && page.url() === address.href
              ? screen
              : null
        };
      } catch (error) {
        await context.close();
        throw error;
      }
    }
  };
}
