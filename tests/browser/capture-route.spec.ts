import {expect, test, type Browser} from '@playwright/test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {capture} from '../../packages/capture/index.mjs';
import {declarativeConfig} from '../../packages/capture/declarative.mjs';

const origin = 'http://atlas-fixture.test';
const screens = [
  {id:'start', route:'/start', entry:'/start.html', title:'首页', ready:{role:'heading', name:'首页'}},
  {id:'detail', route:'/detail', entry:'/right.html', title:'详情', ready:{role:'heading', name:'详情'}},
];
const edges = [{id:'open', source:'start', target:'detail', action:'查看', click:{role:'button', name:'查看'}}];

async function collect(browser: Browser, click: string) {
  const output = await mkdtemp(join(tmpdir(), 'atlas-browser-route-'));
  const {adapter} = declarativeConfig({baseUrl:origin, screens, edges, timeoutMs:2500}, output);
  try {
    return await capture({
      adapter, output, browser:{async newContext(options: Parameters<Browser['newContext']>[0]) {
        const context = await browser.newContext(options);
        await context.route(origin+'/**', route => route.fulfill({
          contentType:'text/html; charset=utf-8',
          body:'<link rel="icon" href="data:,">'+(new URL(route.request().url()).pathname==='/start.html'
            ? '<h1>首页</h1><button>查看</button><script>document.querySelector("button").onclick=()=>{'+click+'}</script>'
            : '<h1>详情</h1>'),
        }));
        return context;
      }},
    });
  } finally {
    await rm(output, {recursive:true, force:true});
  }
}

test('相同 hash 与标题的错误入口不能通过采集验证', async ({browser}) => {
  const result = await collect(browser, 'location.href="/wrong.html#/detail"');
  expect(result.screens.every((screen: {status: string}) => screen.status==='captured')).toBe(true);
  expect(result.edges[0].status).toBe('failed');
  expect(result.edges[0].reason).toContain('/wrong.html#/detail');
});

test('标题先出现时，等待目标路由到位后验证连线', async ({browser}) => {
  const result = await collect(browser,
    'document.querySelector("h1").textContent="详情";setTimeout(()=>location.href="/right.html#/detail",500)');
  expect(result.edges[0].status).toBe('observed');
});
