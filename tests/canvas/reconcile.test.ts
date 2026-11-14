import {it, expect} from 'vitest';
import {reconcileLayout} from '../../packages/viewer/src/canvas/reconcile';
import type {LayoutDocument} from '../../packages/viewer/src/canvas/types';
const n = (id: string, x = 0) => ({id, x, y: 0, width: 224, height: 528, locked: false, hidden: false});
const d: LayoutDocument = {
  schemaVersion: 1,
  nodes: {a: {x: 0, y: 0, locked: false}, b: {x: 500, y: 0, locked: true}},
  viewport: {x: 0, y: 0, zoom: 0.65}
};
it('刷新保留旧坐标，新页不挪动旧页，删除记录不丢失', () => {
  const r = reconcileLayout(d, [n('a'), n('b'), n('c')], []);
  expect(r.document.nodes.a).toEqual(d.nodes.a);
  expect(r.document.nodes.b).toEqual(d.nodes.b);
  expect(r.document.nodes.c).toBeTruthy();
  expect(reconcileLayout(d, [n('a')], []).document.nodes.b).toEqual(d.nodes.b);
});
it('锁定回归冲突进入待处理列表，不改坐标', () => {
  const old = {...d, nodes: {...d.nodes, b: {x: 0, y: 0, locked: true}}};
  const r = reconcileLayout(old, [n('a'), n('b')], [], new Set(['a']));
  expect(r.pendingIds).toContain('b');
  expect(r.document.nodes.b).toEqual(old.nodes.b);
});
it('现有节点尺寸变大只提示冲突，不后台推动', () => {
  const r = reconcileLayout(d, [{...n('a'), width: 600}, n('b')], [], new Set(['a', 'b']));
  expect(r.conflictIds).toContain('a');
  expect(r.document.nodes).toEqual(d.nodes);
});

it('锁定回归待定位状态跨刷新保留，离线期间回归也可识别', () => {
  const old = {...d, nodes: {...d.nodes, b: {x: 0, y: 0, locked: true}}};
  const removed = reconcileLayout(old, [n('a')], []);
  const returned = reconcileLayout(removed.document, [n('a'), n('b')], []);
  expect(returned.pendingIds).toEqual(['b']);
  const loaded = reconcileLayout(returned.document, [n('a'), n('b')], []);
  expect(loaded.pendingIds).toEqual(['b']);
  expect(loaded.document.nodes).toEqual(old.nodes);
});
