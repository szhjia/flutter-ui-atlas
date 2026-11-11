import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import AppMap, {type AtlasViewerAdapter} from '../../packages/viewer/src/AppMap';
import type {AppMapManifest} from '../../packages/viewer/src/model';

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
afterEach(cleanup);

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
