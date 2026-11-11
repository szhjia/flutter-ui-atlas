import {expect, it} from 'vitest';
import {routeEdges} from '../../packages/viewer/src/canvas/route-edges';
import {segmentHits, expand} from '../../packages/viewer/src/canvas/geometry';
const n = (id: string, x: number, y = 0) => ({id, x, y, width: 224, height: 528, hidden: false, locked: false});
it('绕开中间页面，反向与自环有独立路径', () => {
  const nodes = [n('a', 0), n('b', 400), n('c', 800)];
  const edges = [
    {id: 'ac', source: 'a', target: 'c', action: '打开'},
    {id: 'ca', source: 'c', target: 'a', action: '返回'},
    {id: 'aa', source: 'a', target: 'a', action: '刷新'}
  ];
  const r = routeEdges(nodes, edges, [], new Set());
  expect(r.every(e => e.status === 'routed')).toBe(true);
  for (const e of r)
    for (let i = 1; i < e.points.length; i++)
      expect(segmentHits(e.points[i - 1], e.points[i], expand(nodes[1]))).toBe(false);
  expect(r[0].points).not.toEqual([...r[1].points].reverse());
  expect(r[2].points.length).toBeGreaterThan(3);
});
it('移动远处节点不改已合法路径', () => {
  const ns = [n('a', 0), n('b', 800), n('far', 5000)];
  const es = [{id: 'ab', source: 'a', target: 'b', action: ''}];
  const first = routeEdges(ns, es, [], new Set());
  expect(routeEdges([...ns.slice(0, 2), n('far', 6000)], es, first, new Set(['far']))[0]).toBe(first[0]);
});

const box = (id: string, x: number, y: number, width: number, height: number) => ({
  id,
  x,
  y,
  width,
  height,
  hidden: false,
  locked: false
});

it('quick 候选全部被封死时，A* 给出正交绕行路径', () => {
  // L 挡住直线；T/B 封掉 L 展开边界上下的贴线绕行（边界 ε 放行的老陷阱）。
  const nodes = [
    n('a', 0),
    n('b', 1500),
    box('L', 600, 100, 300, 600),
    box('T', 1000, -500, 224, 600),
    box('B', 1000, 600, 224, 200)
  ];
  const [edge] = routeEdges(nodes, [{id: 'ab', source: 'a', target: 'b', action: '打开'}], [], new Set());
  expect(edge.status).toBe('routed');
  // 两端桩 + 至少三个中间航点，确保是真实绕行而非直线
  expect(edge.points.length).toBeGreaterThanOrEqual(5);
  for (let i = 2; i < edge.points.length - 1; i++) {
    const p = edge.points[i - 1],
      q = edge.points[i];
    // 正交：每段要么水平要么垂直
    expect(p.x === q.x || p.y === q.y).toBe(true);
    // 桩外主路径不穿任何障碍（端点桩与源/目标相接属实现的有意豁免，不在此查）
    for (const node of nodes) expect(segmentHits(p, q, expand(node))).toBe(false);
  }
});

it('进入桩被障碍占据时直接返回 unroutable（桩守卫分支）', () => {
  // 障碍 c 覆盖 into→end 进入桩（b 自身被过滤，c 不被过滤），路径在搜索前即被拒绝。
  const nodes = [n('a', 0), n('b', 1500), box('c', 1470, -200, 20, 800)];
  const [edge] = routeEdges(nodes, [{id: 'ab', source: 'a', target: 'b', action: '打开'}], [], new Set());
  expect(edge.status).toBe('unroutable');
  expect(edge.points).toEqual([]);
});

it('目标位于重叠墙围成的封闭区域时，A* 搜索失败且不绘制穿墙连线', () => {
  // into=(1476,264) 与 end=(1500,264) 同在围墙内部，两个桩均未被挡住。
  // 墙体在角部重叠，不能沿单个矩形边界的 epsilon 通道进入内部。
  const walls = [
    box('left', 1400, -160, 40, 850),
    box('top', 1380, -120, 460, 40),
    box('bottom', 1380, 600, 460, 40),
    box('right', 1800, -160, 40, 850)
  ];
  expect(walls.some(w => segmentHits({x: 224, y: 264}, {x: 248, y: 264}, expand(w)))).toBe(false);
  expect(walls.some(w => segmentHits({x: 1476, y: 264}, {x: 1500, y: 264}, expand(w)))).toBe(false);
  const [edge] = routeEdges(
    [n('a', 0), n('b', 1500), ...walls],
    [{id: 'ab', source: 'a', target: 'b', action: '打开'}],
    [],
    new Set()
  );
  expect(edge.status).toBe('unroutable');
  expect(edge.points).toEqual([]);
});
