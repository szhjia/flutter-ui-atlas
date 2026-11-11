import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import AppMap, {type AtlasViewerAdapter} from '../../packages/viewer/src/AppMap';
import type {AppMapManifest} from '../../packages/viewer/src/model';
import {storageKey} from '../../packages/viewer/src/canvas/layout-storage';

// ReactFlow 在 jsdom 中需要 ResizeObserver；stub 掉，不影响本测试关注的数据流。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const manifest: AppMapManifest = {
  schemaVersion: 1,
  captureId: 'capture-1',
  capturedAt: '2026-11-10T10:00:00.000Z',
  sourceFingerprint: '',
  viewport: {width: 393, height: 852},
  theme: '默认主题',
  scenarioId: 'default',
  seedVersion: '1',
  scope: '测试范围',
  screens: [
    {
      id: 'list',
      role: '通用',
      group: '主流程',
      entry: '/',
      route: '/',
      title: '项目列表',
      state: '默认',
      status: 'captured'
    }
  ],
  edges: []
};

function adapterWith(loadManifest: AtlasViewerAdapter['loadManifest']): AtlasViewerAdapter {
  return {loadManifest, loadLatestAttempt: () => Promise.resolve(null)};
}

// vitest 关闭 globals 时 @testing-library 不会自动清理 DOM，手动清。
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('刷新失败时保留上一次成功的画布，并叠加可行动提示', async () => {
  const loadManifest = vi
    .fn()
    .mockResolvedValueOnce(manifest)
    .mockRejectedValueOnce(new Error('无法读取采集结果（HTTP 500）'));
  render(<AppMap adapter={adapterWith(loadManifest)} />);
  await waitFor(() => expect(screen.getAllByText(/项目列表/).length).toBeGreaterThan(0));

  fireEvent.click(screen.getByText('刷新采集结果'));

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('HTTP 500');
  expect(alert.textContent).toContain('当前显示上一次成功结果');
  expect(alert.textContent).toContain('重试');
  expect(screen.getAllByText(/项目列表/).length).toBeGreaterThan(0);
});

it('首次加载失败显示错误屏与重新加载入口（锚定现状）', async () => {
  const loadManifest = vi.fn().mockRejectedValue(new Error('无法读取采集结果（HTTP 500）'));
  render(<AppMap adapter={adapterWith(loadManifest)} />);

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('HTTP 500');
  expect(screen.getByText('重新加载')).toBeTruthy();
  expect(screen.queryByText(/项目列表/)).toBeNull();
});

it('切换适配器来源时立即隔离旧图，失败不能套用新来源的布局与预览', async () => {
  const first = {...adapterWith(async () => manifest), title: '来源 A', layoutKey: 'source-a'};
  const second = {
    ...adapterWith(async () => {
      throw Error('来源 B 不可用');
    }),
    title: '来源 B',
    layoutKey: 'source-b',
    previewUrl: () => 'http://127.0.0.1/b'
  };
  const {rerender} = render(<AppMap adapter={first} />);
  await screen.findByText('项目列表');
  rerender(<AppMap adapter={second} />);
  expect(document.querySelectorAll('.map-card')).toHaveLength(0);
  expect(localStorage.getItem(storageKey('source-b'))).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('来源 B 不可用');
  expect(screen.queryByText('项目列表')).toBeNull();
  expect(screen.getByRole('heading', {name: '来源 B'})).toBeTruthy();
});

it('切换配置产物目录后读取失败，不能继续展示旧目录的页面', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input);
    if (path === '/source-a/manifest.json') return new Response(JSON.stringify(manifest));
    return new Response('', {status: path === '/source-b/manifest.json' ? 500 : 404});
  });
  const {rerender} = render(<AppMap config={{artifactPaths: ['/source-a'], layoutKey: 'same-layout'}} />);
  await screen.findByText('项目列表');
  rerender(<AppMap config={{artifactPaths: ['/source-b'], layoutKey: 'same-layout'}} />);
  expect((await screen.findByRole('alert')).textContent).toContain('HTTP 500');
  expect(screen.queryByText('项目列表')).toBeNull();
});

it('等价配置只改外壳时仍属同来源，刷新失败保留成功画布', async () => {
  let failed = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input =>
    String(input).endsWith('/manifest.json')
      ? new Response(failed ? '' : JSON.stringify(manifest), {status: failed ? 500 : 200})
      : new Response('', {status: 404})
  );
  const {rerender} = render(<AppMap config={{artifactPaths: ['/source-a'], shell: {title: '原品牌'}}} />);
  await screen.findByText('项目列表');
  failed = true;
  rerender(<AppMap config={{artifactPaths: ['/source-a'], shell: {title: '新品牌'}}} />);
  expect((await screen.findByRole('alert')).textContent).toContain('当前显示上一次成功结果');
  expect(screen.getByText('项目列表')).toBeTruthy();
});

it('共享原型方法的不同适配器实例也必须隔离来源', async () => {
  class Adapter implements AtlasViewerAdapter {
    constructor(
      readonly title: string,
      readonly available: boolean
    ) {}
    async loadManifest() {
      if (!this.available) throw Error('实例 B 不可用');
      return manifest;
    }
  }
  const first = new Adapter('实例 A', true);
  const second = new Adapter('实例 B', false);
  expect(first.loadManifest).toBe(second.loadManifest);
  const {rerender} = render(<AppMap adapter={first} />);
  await screen.findByText('项目列表');
  rerender(<AppMap adapter={second} />);
  expect((await screen.findByRole('alert')).textContent).toContain('实例 B 不可用');
  expect(screen.queryByText('项目列表')).toBeNull();
});
