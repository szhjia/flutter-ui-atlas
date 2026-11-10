import {test, expect} from '@playwright/test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runDiscovery} from '../../packages/capture/discovery.mjs';

test('自动采集保留未知候选，手动与测试录制合并同 URL 的真实跳转', async ({browser, baseURL}) => {
  const output = await mkdtemp(join(tmpdir(), 'atlas-browser-discovery-'));
  const start = new URL('/atlas-discovery-test', baseURL).href;
  const viewport = {width: 393, height: 852};
  const screen = (id: string, title: string) => ({id, title, role: id, group: '测试', entry: '/', route: '/', state: title});
  const first = screen('visitor', '访客');
  const second = screen('parent', '家长');
  const pending = screen('pending', '不可复现');
  const launchBrowser = async () => ({
    newContext: browser.newContext.bind(browser),
    close: async () => {},
  });
  const discovery = {
    sourceFingerprint: async () => 'same-source',
    candidates: async () => [{...first, direct: true}, second, {...pending, direct: true}],
    async open({viewport: size}: {viewport: typeof viewport}) {
      const context = await browser.newContext({viewport: size});
      const page = await context.newPage();
      await page.route(start, route => route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<h1>访客</h1><flt-semantics role="button" tabindex="0">登录</flt-semantics><script>document.querySelector("flt-semantics").onclick=()=>{setTimeout(()=>{document.querySelector("h1").textContent="家长"},180)}</script>',
      }));
      await page.goto(start);
      return {page, errors: [], acceptsUrl: (url: string) => url === start,
        close: () => context.close(),
        async observe() {
          if (await page.getByRole('heading', {name: '家长'}).isVisible()) return second;
          return await page.getByRole('heading', {name: '访客'}).isVisible() ? first : null;
        },
      };
    },
    async journeys({watch}: {watch: (session: Awaited<ReturnType<typeof discovery.open>>) => Promise<{
      step(action: string, perform: () => Promise<void>): Promise<void>;
    }>}) {
      const session = await discovery.open({viewport});
      try {
        const observer = await watch(session);
        await observer.step('登录', () => session.page.getByRole('button', {name: '登录'}).click());
        await expect(session.page.getByRole('heading', {name: '家长'})).toBeVisible();
      } finally {
        await session.close();
      }
    },
  };
  const config = {discovery, launchBrowser, output, publicPath: '/generated', viewport};
  try {
    const captured = await runDiscovery({...config, mode: 'capture'});
    expect(captured.screens.find((page: {id: string}) => page.id === pending.id)).toMatchObject({status: 'pending'});
    expect(captured.edges).toEqual([]);
    const manual = await runDiscovery({...config, mode: 'manual', waitForStop: async (session: Awaited<ReturnType<typeof discovery.open>>) => {
      await session.page.getByRole('button', {name: '登录'}).click();
      await expect(session.page.getByRole('heading', {name: '家长'})).toBeVisible();
    }});
    expect(manual.edges).toEqual([expect.objectContaining({source: first.id, target: second.id, status: 'observed', recordingSources: ['manual']})]);
    const replayed = await runDiscovery({...config, mode: 'journeys'});
    expect(replayed.edges).toEqual([expect.objectContaining({source: first.id, target: second.id, recordingSources: ['manual', 'test']})]);
    expect(replayed.screens.find((page: {id: string}) => page.id === second.id)).toMatchObject({status: 'captured'});
    const before = await readFile(join(output, 'manifest.json'), 'utf8');
    await expect(runDiscovery({...config, mode: 'journeys', discovery: {...discovery, journeys: async () => {
      throw Error('流程断言失败');
    }}})).rejects.toThrow('流程断言失败');
    expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(before);
    const next = await runDiscovery({...config, mode: 'capture', discovery: {...discovery, sourceFingerprint: async () => 'different'}});
    expect(next.edges).toEqual([]);
    expect(next.screens.find((page: {id: string}) => page.id === second.id)).toMatchObject({status: 'pending'});
  } finally {
    await rm(output, {recursive: true, force: true});
  }
});
