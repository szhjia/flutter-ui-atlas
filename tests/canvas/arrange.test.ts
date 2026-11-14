import {it, expect} from 'vitest';
import {arrangeNodes} from '../../packages/viewer/src/canvas/arrange';
import {hasSpacingConflict} from '../../packages/viewer/src/canvas/geometry';
const nodes = ['a', 'b', 'c', 'd'].map(id => ({id, x: 0, y: 0, width: 224, height: 528, locked: false, hidden: false}));
const edges = [
  ['a', 'b'],
  ['b', 'a'],
  ['b', 'c']
].map(([source, target]) => ({id: source + target, source, target, action: '下一页'}));
it('循环、分叉和断开子图初排无重叠、确定性', () => {
  const r = arrangeNodes(nodes, edges, new Set(nodes.map(n => n.id)));
  expect(r.ok).toBe(true);
  expect(r.nodes.some((a, i) => r.nodes.slice(i + 1).some(b => hasSpacingConflict(a, b, {x: 160, y: 120})))).toBe(
    false
  );
  expect(arrangeNodes(nodes, edges, new Set(nodes.map(n => n.id)))).toEqual(r);
});
it('只整理可见可移动节点，固定节点坐标不变', () => {
  const input = nodes.map(n => (n.id === 'a' ? {...n, x: 100, y: 100, locked: true} : n));
  const r = arrangeNodes(input, edges, new Set(['b', 'c', 'd']));
  expect(r.ok).toBe(true);
  expect(r.nodes[0]).toEqual(input[0]);
});

it('主流程排在孤立状态前，首次打开即可看到入口', () => {
  const input = [{...nodes[0], id: 'empty'}, ...nodes.map(n => ({...n, id: 'z' + n.id}))];
  const links = [{id: 'z', source: 'za', target: 'zb', action: ''}];
  const r = arrangeNodes(input, links, new Set(input.map(n => n.id)));
  expect(r.nodes.find(n => n.id === 'za')!.y).toBe(0);
  expect(r.nodes.find(n => n.id === 'empty')!.y).toBeGreaterThan(528);
});

it('均衡布局避免长链和大循环退化成一行或一列', () => {
  const many = Array.from({length: 24}, (_, i) => ({...nodes[0], id: `n${i}`}));
  for (const cycle of [false, true]) {
    const links = many
      .slice(0, cycle ? 24 : 23)
      .map((n, i) => ({id: `e${i}`, source: n.id, target: many[(i + 1) % 24].id, action: ''}));
    const r = arrangeNodes(many, links, new Set(many.map(n => n.id)), {mode: 'balanced', aspectRatio: 1.3});
    const width = Math.max(...r.nodes.map(n => n.x + n.width)),
      height = Math.max(...r.nodes.map(n => n.y + n.height));
    expect(width / height).toBeGreaterThan(0.7);
    expect(width / height).toBeLessThan(2);
    expect(r.nodes.some((a, i) => r.nodes.slice(i + 1).some(b => hasSpacingConflict(a, b, {x: 160, y: 120})))).toBe(
      false
    );
  }
});
it('横向与纵向流程预设保持方向，隐藏及锁定节点不移动', () => {
  const input = ['a', 'b', 'c'].map(id => ({...nodes[0], id}));
  const links = [
    {id: 'ab', source: 'a', target: 'b', action: ''},
    {id: 'bc', source: 'b', target: 'c', action: ''}
  ];
  const ids = new Set(input.map(n => n.id));
  const horizontal = arrangeNodes(input, links, ids, {mode: 'horizontal'});
  const vertical = arrangeNodes(input, links, ids, {mode: 'vertical'});
  expect(horizontal.nodes[2].x).toBeGreaterThan(horizontal.nodes[0].x);
  expect(vertical.nodes[2].y).toBeGreaterThan(vertical.nodes[0].y);
  const locked = {...input[0], x: -500, locked: true};
  const hidden = {...input[1], x: 5000, hidden: true};
  const result = arrangeNodes([locked, hidden, input[2]], links, ids, {mode: 'balanced'});
  expect(result.nodes[0]).toEqual(locked);
  expect(result.nodes[1]).toEqual(hidden);
});
