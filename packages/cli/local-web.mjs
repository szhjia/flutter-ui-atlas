import {webUrl} from '../capture/declarative.mjs';

const readyTimeout = 15000;

export function localWebDiscovery(value, readyText) {
  const address = webUrl(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) {
    throw Error('--url 必须是本地 Flutter Web 开发服务的回环地址。');
  }
  const route = address.hash.startsWith('#/') ? address.hash.slice(1).split('?')[0] : address.pathname;
  const screen = {
    id: 'entry', role: '默认', group: '页面', state: '默认状态',
    title: readyText ?? '入口页面', entry: address.href, route, direct: true,
    discoverySource: '命令行指定入口',
  };

  return {
    candidates: async () => [screen],
    requireCapture: Boolean(readyText),
    async open({browser, viewport}) {
      const context = await browser.newContext({viewport, serviceWorkers: 'block'});
      try {
        const page = await context.newPage();
        await page.addInitScript(() => {
          window.addEventListener('flutter-first-frame', () => { window.__atlasFlutterFirstFrame = true; }, {once: true});
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
          const enable = page.locator('flt-semantics-placeholder')
            .and(page.getByRole('button', {name: 'Enable accessibility', exact: true}));
          const deadline = Date.now() + readyTimeout;
          try {
            await content.or(enable).first().waitFor({state: 'visible', timeout: readyTimeout});
            if (!await content.isVisible() && await enable.isVisible()) {
              // 引擎会先创建无障碍入口，再装载 Flutter 视图和语义树。
              await page.waitForFunction(() => window.__atlasFlutterFirstFrame ||
                document.querySelector('flutter-view flt-semantics-host'), null,
              {timeout: Math.max(1, deadline - Date.now())});
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
          page, errors, close: () => context.close(),
          observe: async () => content && page.url() === address.href &&
            await content.isVisible() && page.url() === address.href ? screen : null,
        };
      } catch (error) {
        await context.close();
        throw error;
      }
    },
  };
}
