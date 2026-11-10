import {afterEach, expect, it, vi} from 'vitest';
import {createPreviewUrl, readViewerSnapshot, safeLink} from '../../packages/viewer/src/config';
import {graph} from '../browser/fixtures/graphs';

const sources = {artifactPaths: ['/auto', '/legacy']};
const legacy = graph(2);
const attempt = {status: 'failed', captureId: 'later', error: '采集失败', report: '/legacy/report'};
afterEach(() => vi.unstubAllGlobals());

it.each([404, 200])('自动图谱缺失时从旧目录读取地图和报告（HTTP %i）', async status => {
  const fetch = vi.fn(async (path: string) => {
    if (path === '/auto/manifest.json') return new Response('<html>', {status, headers: {'content-type': 'text/html'}});
    if (path === '/legacy/manifest.json') return Response.json(legacy);
    return Response.json(attempt);
  });
  vi.stubGlobal('fetch', fetch);
  expect(await readViewerSnapshot(sources)).toEqual({map: legacy, attempt, error: ''});
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    '/auto/manifest.json', '/legacy/manifest.json', '/legacy/latest-attempt.json',
  ]);
});

it.each([
  {response: () => new Response('{'), error: '采集文件格式不正确'},
  {response: () => Response.json({...legacy, screens: [null]}), error: '采集文件格式不正确'},
  {response: () => new Response(null, {status: 503}), error: '无法读取采集结果（HTTP 503）'},
])('自动图谱损坏或请求失败时保留该目录的报告', async ({response, error}) => {
  const fetch = vi.fn(async (path: string) => path.endsWith('/manifest.json') ? response() : Response.json(attempt));
  vi.stubGlobal('fetch', fetch);
  expect(await readViewerSnapshot(sources)).toEqual({map: null, attempt, error});
  expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/auto/manifest.json', '/auto/latest-attempt.json']);
});

it('预览使用声明的入口、路由和新会话，并拒绝清单中的非授权路径', () => {
  const resolve = createPreviewUrl({
    origin: 'http://localhost:3100',
    sessionParam: 'environmentId',
    query: {scenarioId: 'demo'},
    entries: {
      'app.html': {path: '/app.html'},
      'student.html': {path: '/student.html', hashRoute: true},
    },
  })!;
  const screen = {...legacy.screens[0], entry: 'student.html', route: 'learning-library'};
  const first = new URL(resolve(screen, 'first')!);
  expect(first.pathname).toBe('/student.html');
  expect(first.hash).toBe('#/learning-library');
  expect(first.searchParams.get('environmentId')).toBe('first');
  expect(first.searchParams.get('scenarioId')).toBe('demo');
  const second = new URL(resolve({...screen, previewPath: '/student.html?environmentId=old#/new'}, 'second')!);
  expect(second.hash).toBe('#/new');
  expect(second.searchParams.get('environmentId')).toBe('second');
  expect(new URL(resolve({...screen, entry: 'app.html'}, 'login')!).hash).toBe('');
  expect(resolve({...screen, entry: 'https://outside.example'}, 'x')).toBeNull();
  expect(resolve({...screen, previewPath: '/app.html'}, 'x')).toBeNull();
  expect(resolve({...screen, previewPath: '//outside.example/student.html'}, 'x')).toBeNull();
});

it('页眉链接接受本站路径和 HTTP(S) URL，拒绝带凭据或可执行地址', () => {
  expect(['/','https://example.test/guide'].every(safeLink)).toBe(true);
  expect(['javascript:alert(1)', '//example.test', 'https://user@example.test'].some(safeLink)).toBe(false);
});
