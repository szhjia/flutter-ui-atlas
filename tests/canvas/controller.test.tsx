import {act, cleanup, renderHook} from '@testing-library/react';
import {expect, it, beforeEach, afterEach, vi} from 'vitest';
import {useCanvasController} from '../../packages/viewer/src/canvas/useCanvasController';
import {storageKey} from '../../packages/viewer/src/canvas/layout-storage';
const map: any = {captureId: '1', screens: ['a', 'b', 'c'].map(id => ({id})), edges: []};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    storageKey('test'),
    JSON.stringify({
      schemaVersion: 1,
      nodes: {a: {x: 0, y: 0, locked: false}, b: {x: 500, y: 0, locked: false}, c: {x: 3000, y: 0, locked: true}},
      viewport: {x: 40, y: 35, zoom: 0.65}
    })
  );
});
it('预览不存储，松手整组提交，一次撤销与重做', () => {
  const {result} = renderHook(() =>
    useCanvasController({map, layoutKey: 'test', visibleIds: new Set(['a', 'b', 'c'])})
  );
  const before = localStorage.getItem(storageKey('test'));
  act(() => {
    result.current.onDragStart('a');
    result.current.onDrag('a', {x: 300, y: 0});
  });
  expect(localStorage.getItem(storageKey('test'))).toBe(before);
  act(() => result.current.onDragStop('a', {x: 300, y: 0}));
  expect(result.current.nodes.find(n => n.id === 'b')!.x).toBeGreaterThanOrEqual(620);
  expect(result.current.nodes.find(n => n.id === 'c')!.x).toBe(3000);
  act(() => result.current.undo());
  expect(result.current.nodes[0].x).toBe(0);
  expect(result.current.nodes[1].x).toBe(500);
  act(() => result.current.redo());
  expect(result.current.nodes[0].x).toBe(300);
});
it('取消恢复全组；过滤和新采集不提交旧手势', () => {
  const {result, rerender} = renderHook(
    ({m, ids}) => useCanvasController({map: m, layoutKey: 'test', visibleIds: new Set(ids)}),
    {initialProps: {m: map, ids: ['a', 'b', 'c']}}
  );
  act(() => {
    result.current.onDragStart('a');
    result.current.onDrag('a', {x: 300, y: 0});
    result.current.cancelDrag();
  });
  expect(result.current.nodes[0].x).toBe(0);
  rerender({m: map, ids: ['a']});
  expect(result.current.nodes[1].x).toBe(500);
  expect(result.current.viewport.zoom).toBe(0.65);
  act(() => result.current.onDragStart('a'));
  rerender({m: {...map, captureId: '2'}, ids: ['a']});
  act(() => result.current.onDragStop('a', {x: 100, y: 0}));
  expect(result.current.nodes[0].x).toBe(0);
});
it('锁定不能移动，外部布局只提示并手动载入', () => {
  const {result} = renderHook(() =>
    useCanvasController({map, layoutKey: 'test', visibleIds: new Set(['a', 'b', 'c'])})
  );
  act(() => result.current.moveByKeyboard('c', {x: 10, y: 0}));
  expect(result.current.nodes[2].x).toBe(3000);
  const d = JSON.parse(localStorage.getItem(storageKey('test'))!);
  d.nodes.a.x = -500;
  localStorage.setItem(storageKey('test'), JSON.stringify(d));
  act(() => window.dispatchEvent(new StorageEvent('storage', {key: storageKey('test')})));
  expect(result.current.externalAvailable).toBe(true);
  expect(result.current.nodes[0].x).toBe(0);
  act(() => result.current.loadExternalLayout());
  expect(result.current.nodes[0].x).toBe(-500);
});

it('待定位页自动恢复后撤销，重新进入待定位而不叠在占位页上', () => {
  const d = JSON.parse(localStorage.getItem(storageKey('test'))!);
  d.nodes.b = {x: 0, y: 0, locked: true};
  localStorage.setItem(storageKey('test'), JSON.stringify(d));
  const first = {...map, screens: [{id: 'a'}]};
  const {result, rerender} = renderHook(
    ({m}) => useCanvasController({map: m, layoutKey: 'test', visibleIds: new Set(['a', 'b'])}),
    {initialProps: {m: first}}
  );
  rerender({m: {...first, captureId: '2', screens: [{id: 'a'}, {id: 'b'}]}});
  expect(result.current.pendingIds).toEqual(['b']);
  act(() => result.current.moveByKeyboard('a', {x: 1000, y: 0}));
  expect(result.current.pendingIds).toEqual([]);
  act(() => result.current.undo());
  expect(result.current.pendingIds).toEqual(['b']);
  expect(result.current.nodes.map(n => n.id)).toEqual(['a']);
});

it('损坏布局给出恢复出口：丢弃后自动整理并恢复保存', () => {
  localStorage.setItem(storageKey('broken'), '{bad');
  const {result} = renderHook(() =>
    useCanvasController({map, layoutKey: 'broken', visibleIds: new Set(['a', 'b', 'c'])})
  );
  expect(result.current.corrupted).toBe(true);
  expect(result.current.issue).toContain('丢弃');
  expect(localStorage.getItem(storageKey('broken'))).toBe('{bad');
  act(() => result.current.discardCorruptedLayout());
  expect(result.current.corrupted).toBe(false);
  expect(result.current.pendingIds).toEqual([]);
  expect(result.current.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'c']);
  const saved = JSON.parse(localStorage.getItem(storageKey('broken'))!);
  expect(saved.schemaVersion).toBe(1);
  expect(Object.keys(saved.nodes).sort()).toEqual(['a', 'b', 'c']);
});

it('另一窗口修复存储后点丢弃：不删好数据，转回外部布局选择', () => {
  localStorage.setItem(storageKey('broken'), '{bad');
  const {result} = renderHook(() =>
    useCanvasController({map, layoutKey: 'broken', visibleIds: new Set(['a', 'b', 'c'])})
  );
  expect(result.current.corrupted).toBe(true);
  localStorage.setItem(
    storageKey('broken'),
    JSON.stringify({schemaVersion: 1, nodes: {a: {x: 10, y: 0, locked: false}}, viewport: {x: 0, y: 0, zoom: 0.5}})
  );
  act(() => result.current.discardCorruptedLayout());
  expect(result.current.corrupted).toBe(false);
  expect(JSON.parse(localStorage.getItem(storageKey('broken'))!).nodes.a.x).toBe(10);
  expect(result.current.issue).toContain('已可读');
  expect(result.current.externalAvailable).toBe(true);
});

it('丢弃后保存失败必须保留诊断，不能宣称布局已保存', () => {
  localStorage.setItem(storageKey('broken'), '{bad');
  const {result} = renderHook(() =>
    useCanvasController({map, layoutKey: 'broken', visibleIds: new Set(['a', 'b', 'c'])})
  );
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('存储已满', 'QuotaExceededError');
  });
  act(() => result.current.discardCorruptedLayout());
  expect(result.current.corrupted).toBe(false);
  expect(localStorage.getItem(storageKey('broken'))).toBeNull();
  expect(result.current.issue).toContain('布局未保存');
});

it('载入外部损坏布局同步恢复入口状态，丢弃后重新保存', () => {
  const {result} = renderHook(() =>
    useCanvasController({map, layoutKey: 'test', visibleIds: new Set(['a', 'b', 'c'])})
  );
  localStorage.setItem(storageKey('test'), '{bad');
  act(() => window.dispatchEvent(new StorageEvent('storage', {key: storageKey('test')})));
  act(() => result.current.loadExternalLayout());
  expect(result.current.corrupted).toBe(true);
  expect(result.current.issue).toContain('可丢弃');
  expect(localStorage.getItem(storageKey('test'))).toBe('{bad');
  act(() => result.current.discardCorruptedLayout());
  expect(result.current.corrupted).toBe(false);
  expect(result.current.issue).toBeNull();
  expect(JSON.parse(localStorage.getItem(storageKey('test'))!).schemaVersion).toBe(1);
});

it('保留当前布局也会识别外部损坏，不覆盖原数据并提供恢复入口', () => {
  const {result} = renderHook(() =>
    useCanvasController({map, layoutKey: 'test', visibleIds: new Set(['a', 'b', 'c'])})
  );
  localStorage.setItem(storageKey('test'), '{bad');
  act(() => window.dispatchEvent(new StorageEvent('storage', {key: storageKey('test')})));
  act(() => result.current.keepLocalLayout());
  expect(result.current.corrupted).toBe(true);
  expect(result.current.issue).toContain('丢弃');
  expect(localStorage.getItem(storageKey('test'))).toBe('{bad');
});
