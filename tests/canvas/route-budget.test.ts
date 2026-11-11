import {expect, it, vi} from 'vitest';
import {routeEdges} from '../../packages/viewer/src/canvas/route-edges';

// 用受控资源上限触发真实搜索耗尽，避免依赖机器性能或构造数千个障碍。
vi.mock('../../packages/viewer/src/canvas/constants', async importOriginal => ({
  ...(await importOriginal<typeof import('../../packages/viewer/src/canvas/constants')>()),
  EDGE_SEARCH_BUDGET: 1
}));

it('A* 预算耗尽时返回不可路由，不能输出未验证的穿障碍路径', () => {
  const box = (id: string, x: number, y: number, width: number, height: number) => ({
    id,
    x,
    y,
    width,
    height,
    hidden: false,
    locked: false
  });
  // 与正常预算下可绕行的正向用例相同；quick 全被阻挡，桩不受阻。
  const nodes = [
    box('a', 0, 0, 224, 528),
    box('b', 1500, 0, 224, 528),
    box('L', 600, 100, 300, 600),
    box('T', 1000, -500, 224, 600),
    box('B', 1000, 600, 224, 200)
  ];
  const [edge] = routeEdges(nodes, [{id: 'ab', source: 'a', target: 'b', action: '打开'}], [], new Set());
  expect(edge.status).toBe('unroutable');
  expect(edge.points).toEqual([]);
});
