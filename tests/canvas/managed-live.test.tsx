import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import AppMap, {type AtlasViewerAdapter} from '../../packages/viewer/src/AppMap';
import {
  type AtlasLiveSessionInput,
  type AtlasLiveSessionHandle,
  createManagedLiveAdapter
} from '../../packages/viewer/src/config';
import {graph} from '../browser/fixtures/graphs';
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
function setup(openLiveSession: AtlasViewerAdapter['openLiveSession']) {
  const map = graph(2);
  const closeLiveSession = vi.fn(async () => {});
  const adapter = {loadManifest: async () => map, openLiveSession, closeLiveSession};
  const view = render(<AppMap adapter={adapter} />);
  return {map, adapter, closeLiveSession, ...view};
}
async function choose(id: string) {
  await waitFor(() => expect(document.querySelector(`[data-id="${id}"] .map-card`)).toBeTruthy());
  fireEvent.click(document.querySelector(`[data-id="${id}"] .map-card`)!);
}
it('独立会话等待就绪后显示已打开，不创建iframe；切换卡片取消且迟到响应仅清理旧资源', async () => {
  let finish!: (value: any) => void;
  const open = vi.fn(
    (_input: AtlasLiveSessionInput) =>
      new Promise<AtlasLiveSessionHandle>(resolve => {
        finish = resolve;
      })
  );
  const {map, closeLiveSession} = setup(open);
  await choose(map.screens[0].id);
  fireEvent.click(screen.getByText('实时操作'));
  expect(screen.getByText(/正在准备独立/)).toBeTruthy();
  const input = open.mock.calls[0][0];
  expect(input.captureId).toBe(map.captureId);
  fireEvent.click(screen.getAllByRole('button').find(button => button.classList.contains('map-relation'))!);
  expect(input.signal.aborted).toBe(true);
  expect(closeLiveSession).toHaveBeenCalledWith(input.requestId);
  finish({id: 'old', requestId: input.requestId, screenId: input.screenId, captureId: input.captureId, state: 'ready'});
  await waitFor(() => expect(closeLiveSession).toHaveBeenCalledWith('old'));
  expect(document.querySelector('iframe')).toBeNull();
  expect(screen.queryByText(/已在独立 Chrome/)).toBeNull();
});
it('就绪、显式关闭、刷新和卸载都按所属请求关闭；失败可见', async () => {
  const open = vi.fn(async (input: AtlasLiveSessionInput): Promise<AtlasLiveSessionHandle> => ({
    id: input.requestId,
    requestId: input.requestId,
    screenId: input.screenId,
    captureId: input.captureId,
    state: 'ready'
  }));
  const {map, closeLiveSession, unmount} = setup(open);
  await choose(map.screens[0].id);
  fireEvent.click(screen.getByText('实时操作'));
  expect(await screen.findByText(/已在独立 Chrome/)).toBeTruthy();
  fireEvent.click(screen.getByText('关闭实时会话'));
  expect(screen.getByText(/实时会话已关闭/)).toBeTruthy();
  expect(closeLiveSession).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('实时操作'));
  await screen.findByText(/已在独立 Chrome/);
  fireEvent.click(screen.getByText('刷新采集结果'));
  expect(closeLiveSession).toHaveBeenCalledTimes(2);
  open.mockRejectedValueOnce(Error('登录失败'));
  fireEvent.click(screen.getByText('实时操作'));
  expect((await screen.findByRole('alert')).textContent).toContain('登录失败');
  fireEvent.click(screen.getByText('实时操作'));
  await screen.findByText(/已在独立 Chrome/);
  unmount();
  expect(closeLiveSession).toHaveBeenCalledTimes(4);
});
it('配置适配器仅向本站endpoint发送标识和token，取消主动关闭对应请求', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({id: 'ready'}));
  const client = createManagedLiveAdapter({endpoint: '/__atlas/live', token: 'secret'})!;
  const controller = new AbortController();
  await client.openLiveSession({screenId: 'screen', captureId: 'capture', requestId: 'req', signal: controller.signal});
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/__atlas/live/open');
  expect(JSON.parse(String(init?.body))).toEqual({screenId: 'screen', captureId: 'capture', requestId: 'req'});
  expect(init?.headers).toMatchObject({'x-atlas-token': 'secret'});
  expect(() => createManagedLiveAdapter({endpoint: 'https://evil.test/live', token: 'x'})).toThrow(/本站/);
});
it('窗口被手动关闭后显示关闭状态，切换来源清理所属会话', async () => {
  const open = vi.fn(async (input: AtlasLiveSessionInput): Promise<AtlasLiveSessionHandle> => ({
    ...input,
    id: input.requestId,
    state: 'ready'
  }));
  const {map, adapter, closeLiveSession, rerender} = setup(open);
  const liveSessionStatus = vi.fn(async () => ({state: 'idle' as const}));
  rerender(<AppMap adapter={{...adapter, liveSessionStatus}} />);
  await choose(map.screens[0].id);
  fireEvent.click(screen.getByText('实时操作'));
  await screen.findByText(/已在独立 Chrome/);
  await waitFor(() => expect(screen.getByText(/实时会话已关闭/)).toBeTruthy(), {timeout: 2500});
  expect(closeLiveSession).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('实时操作'));
  await screen.findByText(/已在独立 Chrome/);
  rerender(<AppMap adapter={{loadManifest: async () => map}} />);
  expect(closeLiveSession).toHaveBeenCalledTimes(2);
});
it('未启用managed会话的旧适配器仍使用iframe预览', async () => {
  const map = graph(2);
  render(<AppMap adapter={{loadManifest: async () => map, previewUrl: () => 'http://127.0.0.1:60210/#/home'}} />);
  await choose(map.screens[0].id);
  fireEvent.click(screen.getByText('实时操作'));
  expect(document.querySelector('iframe')?.src).toBe('http://127.0.0.1:60210/#/home');
  expect(screen.queryByText('关闭实时会话')).toBeNull();
});
