import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {sourceFingerprintForFiles} from '../packages/capture/declarative.mjs';

const origin = 'http://127.0.0.1:60210';
const directory = fileURLToPath(new URL('.', import.meta.url));
const sourceFiles = ['flutter_app/lib/main.dart', 'flutter_app/pubspec.yaml', 'flutter_app/web/index.html', 'flutter_app/assets/fonts/NotoSansSC-Regular.ttf'];
let routes;

async function candidates() {
  const code = await readFile(new URL(sourceFiles[0], import.meta.url), 'utf8');
  // 示例只读取本应用 routes 表中固定格式的 ExamplePage 声明。
  routes = new Map([...code.matchAll(/^\s*'(\/[\w/-]*)': \(context\) => const ExamplePage\(title: '([^']+)'/gm)].map(([, route, title]) => [
    route, {id: route, entry: '/', route, title, role: '演示', group: '页面', state: '默认状态',
      discoverySource: sourceFiles[0], previewPath: `/#${route}`, direct: true},
  ]));
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
        const spec = routes.get(url.hash.slice(1) || '/');
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

export default {
  title: 'Flutter UI Atlas',
  output: '.atlas/discovery',
  discovery: {candidates, open, journeys, preview: {origin}, sourceFingerprint: sourceFingerprintForFiles(sourceFiles, directory)},
};
