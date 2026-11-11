import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {sourceFingerprintForFiles} from '../packages/capture/declarative.mjs';

const origin = 'http://127.0.0.1:60210';
const directory = fileURLToPath(new URL('.', import.meta.url));
const sourceFiles = ['flutter_app/lib/main.dart', 'flutter_app/pubspec.yaml', 'flutter_app/web/index.html', 'flutter_app/assets/fonts/NotoSansSC-Regular.ttf'];

/** 从示例应用源码解析 routes 表里的 ExamplePage 声明（const 可选、支持多行）。 */
export function parseRouteDeclarations(code) {
  const pattern = /^\s*'(\/[\w/-]*)'\s*:\s*\(context\)\s*=>\s*(?:const\s+)?ExamplePage\(\s*title:\s*'([^']+)'/gm;
  return new Map([...code.matchAll(pattern)].map(([, route, title]) => [
    route, {id: route, entry: '/', route, title, role: '演示', group: '页面', state: '默认状态',
      discoverySource: sourceFiles[0], previewPath: `/#${route}`, direct: true},
  ]));
}

/** hash 路由解析：忽略 fragment 内查询参数，空等价于 '/'（与 declarative.mjs 语义一致）。 */
export function hashRouteOf(url) {
  return url.hash.slice(1).split('?')[0] || '/';
}

export function buildDiscovery({readFile: readSource = readFile} = {}) {
  // 闭包持有路由表：两个并发 runDiscovery 不再共享模块级可变状态。readFile 可注入供测试。
  let routes = new Map();
  async function candidates() {
    const code = await readSource(new URL(sourceFiles[0], import.meta.url), 'utf8');
    routes = parseRouteDeclarations(code);
    if (!routes.size) {
      throw Error(`已在 ${sourceFiles[0]} 声明路由表，但没有匹配到任何 ExamplePage 声明。请检查声明格式（'路由': (context) => ExamplePage(title: '标题')），或改用自己的解析逻辑。`);
    }
    return [...routes.values()];
  }

  async function open({browser, viewport, candidate}) {
    const context = await browser.newContext({viewport});
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + (candidate?.previewPath ?? '/'));
      await page.locator('flt-semantics').first().waitFor({state: 'attached'});
      return {
        page, errors, close: () => context.close(),
        acceptsUrl: url => new URL(url).origin === origin,
        async observe() {
          const url = new URL(page.url());
          const spec = routes.get(hashRouteOf(url));
          if (url.origin !== origin || url.pathname !== '/' || !spec) return null;
          const heading = page.getByRole('heading', {name: spec.title, exact: true}).first();
          const visible = await heading.isVisible();
          if (!visible || page.url() !== url.href) return null;
          const {direct, ...screen} = spec;
          return screen;
        },
      };
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  async function journeys({browser, viewport, watch}) {
    const session = await open({browser, viewport});
    try {
      const observer = await watch(session);
      for (const action of ['进入示例', '查看详情', '打开设置']) {
        await observer.step(action, () => session.page.getByRole('button', {name: action, exact: true}).click());
      }
      if (!session.page.url().endsWith('#/settings')) throw Error('流程未到达偏好设置');
      if (session.errors.length) throw Error(session.errors.join('\n'));
    } finally {
      await session.close();
    }
  }

  return {candidates, open, journeys, preview: {origin}, sourceFingerprint: sourceFingerprintForFiles(sourceFiles, directory)};
}

export default {
  title: 'Flutter UI Atlas',
  output: '.atlas/discovery',
  discovery: buildDiscovery(),
};
