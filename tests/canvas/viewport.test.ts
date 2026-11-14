import {expect, it} from 'vitest';
import {CANVAS_ZOOM} from '../../packages/viewer/src/canvas/constants';
import {clampZoom, constrainViewport, fitViewport, panExtent} from '../../packages/viewer/src/canvas/viewport';
import {readLayout, storageKey} from '../../packages/viewer/src/canvas/layout-storage';
const nodes = [
  {id: 'a', x: 0, y: 0, width: 224, height: 528, locked: false, hidden: false},
  {id: 'b', x: 800, y: 650, width: 224, height: 528, locked: false, hidden: false}
];
it('缩放为默认视图的 0.5 到 2 倍，适应视图也遵守范围', () => {
  expect(clampZoom(0.01)).toBe(CANVAS_ZOOM.base * 0.5);
  expect(clampZoom(100)).toBe(CANVAS_ZOOM.base * 2);
  expect(fitViewport(nodes, {width: 900, height: 800}).zoom).toBeGreaterThanOrEqual(CANVAS_ZOOM.min);
  expect(fitViewport([], {width: 900, height: 800}).zoom).toBe(CANVAS_ZOOM.base);
});
it('平移在内容加留白的有限范围内，旧节点可在负坐标', () => {
  const extent = panExtent(nodes);
  const low = constrainViewport({x: -1e9, y: -1e9, zoom: 0.65}, {width: 900, height: 800}, extent);
  const high = constrainViewport({x: 1e9, y: 1e9, zoom: 0.65}, {width: 900, height: 800}, extent);
  expect(low.x).toBeGreaterThan(-1e4);
  expect(high.x).toBeLessThan(1e4);
  expect(low.x).toBeLessThanOrEqual(high.x);
  expect(panExtent([{...nodes[0], x: -2000}])[0][0]).toBe(-2480);
});
it('旧缩放超限只归一化视口，保留布局及锁定而不报损坏', () => {
  const doc = {schemaVersion: 1, nodes: {a: {x: -500, y: 10, locked: true}}, viewport: {x: 2, y: 3, zoom: 0.08}};
  localStorage.setItem(storageKey('old-zoom'), JSON.stringify(doc));
  const result = readLayout(localStorage, 'old-zoom');
  expect(result.corrupted).toBe(false);
  expect(result.document!.nodes).toEqual(doc.nodes);
  expect(result.document!.viewport.zoom).toBe(CANVAS_ZOOM.min);
  expect(JSON.parse(localStorage.getItem(storageKey('old-zoom'))!).viewport.zoom).toBe(0.08);
});
