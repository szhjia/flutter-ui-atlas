import {afterEach, expect, it, vi} from 'vitest';
import {createPreviewUrl, readViewerSnapshot, safeLink} from '../../packages/viewer/src/config';
import {graph} from '../browser/fixtures/graphs';

const sources = {artifactPaths: ['/auto', '/legacy']};
const legacy = graph(2);
const attempt = {status: 'failed', captureId: 'later', error: 'Capture failed', report: '/legacy/report'};
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
    '/auto/manifest.json',
    '/legacy/manifest.json',
    '/legacy/latest-attempt.json'
  ]);
});

it.each([
  {response: () => new Response('{'), error: 'Invalid capture manifest'},
  {response: () => Response.json({...legacy, screens: [null]}), error: 'Invalid capture manifest'},
  {response: () => new Response(null, {status: 503}), error: 'Could not load captures (HTTP 503)'}
])('自动图谱损坏或请求失败时保留该目录的报告', async ({response, error}) => {
  const fetch = vi.fn(async (path: string) => (path.endsWith('/manifest.json') ? response() : Response.json(attempt)));
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
      'student.html': {path: '/student.html', hashRoute: true}
    }
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
  expect(['/', 'https://example.test/guide'].every(safeLink)).toBe(true);
  expect(['javascript:alert(1)', '//example.test', 'https://user@example.test'].some(safeLink)).toBe(false);
});

it('拒绝旧的同账户同路由重复状态产物并提供重新采集诊断', async () => {
  const duplicate = structuredClone(legacy);
  duplicate.screens[1] = {...duplicate.screens[0], id: 'legacy-error', state: 'Wrong password'};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path.endsWith('/manifest.json') ? Response.json(duplicate) : new Response('', {status: 404})
    )
  );
  const snapshot = await readViewerSnapshot(sources);
  expect(snapshot.map).toBeNull();
  expect(snapshot.error).toMatch(/duplicate route/i);
});
