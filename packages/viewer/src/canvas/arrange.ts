import type {CanvasNode, EdgeSpec, Point, SolveResult} from './types';
import {hasSpacingConflict} from './geometry';
import {ARRANGE_GAP, COMPONENT_GAP, DEFAULT_NODE_SIZE, NEAREST_ATTEMPT_BUDGET, NEAREST_RING_LIMIT} from './constants';
export function nearestFree(node: CanvasNode, occupied: CanvasNode[], origin: Point, gap = ARRANGE_GAP): Point | null {
  let attempts = 0;
  for (let ring = 0; ring < NEAREST_RING_LIMIT; ring++) {
    const spots: Point[] = [];
    for (let dx = -ring; dx <= ring; dx++)
      for (const dy of new Set([ring - Math.abs(dx), -ring + Math.abs(dx)]))
        spots.push({x: origin.x + dx * (node.width + gap.x), y: origin.y + dy * (node.height + gap.y)});
    spots.sort(
      (a, b) =>
        Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y) ||
        a.y - b.y ||
        a.x - b.x
    );
    for (const p of spots) {
      if (++attempts > NEAREST_ATTEMPT_BUDGET) return null;
      if (!occupied.some(n => hasSpacingConflict({...node, ...p}, n, gap))) return p;
    }
  }
  return null;
}
export function arrangeNodes(nodes: CanvasNode[], edges: EdgeSpec[], movableIds: Set<string>): SolveResult {
  const moving = nodes.filter(n => movableIds.has(n.id) && !n.locked && !n.hidden),
    ids = new Set(moving.map(n => n.id));
  const adjacency = new Map(
    moving.map(n => [
      n.id,
      edges
        .filter(e => e.source === n.id && ids.has(e.target))
        .map(e => e.target)
        .sort()
    ])
  );
  // Tarjan：循环只参与一次层次计算，不无限增加层数。
  let clock = 0;
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    active = new Set<string>(),
    groups: string[][] = [];
  function visit(id: string) {
    index.set(id, clock);
    low.set(id, clock++);
    stack.push(id);
    active.add(id);
    for (const child of adjacency.get(id) ?? []) {
      if (!index.has(child)) {
        visit(child);
        low.set(id, Math.min(low.get(id)!, low.get(child)!));
      } else if (active.has(child)) low.set(id, Math.min(low.get(id)!, index.get(child)!));
    }
    if (low.get(id) === index.get(id)) {
      const group: string[] = [];
      let child: string;
      do {
        child = stack.pop()!;
        active.delete(child);
        group.push(child);
      } while (child !== id);
      groups.push(group.sort());
    }
  }
  for (const n of [...moving].sort((a, b) => a.id.localeCompare(b.id))) if (!index.has(n.id)) visit(n.id);
  const groupOf = new Map(groups.flatMap((g, i) => g.map(id => [id, i] as const))),
    ranks = groups.map(() => 0),
    arcs = edges
      .filter(e => ids.has(e.source) && ids.has(e.target))
      .map(e => [groupOf.get(e.source)!, groupOf.get(e.target)!])
      .filter(([a, b]) => a !== b);
  for (let pass = 0; pass < groups.length; pass++)
    for (const [a, b] of arcs) ranks[b] = Math.max(ranks[b], ranks[a] + 1);
  const weak = new Map<string, string>();
  function root(id: string): string {
    const p = weak.get(id);
    return !p || p === id ? id : root(p);
  }
  for (const n of moving) weak.set(n.id, n.id);
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target)) weak.set(root(e.target), root(e.source));
  const components = [...new Set(moving.map(n => root(n.id)))].sort(
      (a, b) =>
        moving.filter(n => root(n.id) === b).length - moving.filter(n => root(n.id) === a).length || a.localeCompare(b)
    ),
    maxWidth = Math.max(DEFAULT_NODE_SIZE.width, ...moving.map(n => n.width)),
    maxHeight = Math.max(DEFAULT_NODE_SIZE.height, ...moving.map(n => n.height));
  const occupied = nodes.filter(n => !ids.has(n.id)).map(n => ({...n})),
    placed = new Map<string, CanvasNode>();
  let groupY = 0;
  for (const component of components) {
    const columns = new Map<number, number>();
    let bottom = groupY;
    for (const n of moving
      .filter(n => root(n.id) === component)
      .sort((a, b) => ranks[groupOf.get(a.id)!] - ranks[groupOf.get(b.id)!] || a.id.localeCompare(b.id))) {
      const rank = ranks[groupOf.get(n.id)!],
        row = columns.get(rank) ?? 0;
      columns.set(rank, row + 1);
      const point = nearestFree(n, occupied, {
        x: rank * (maxWidth + ARRANGE_GAP.x),
        y: groupY + row * (maxHeight + ARRANGE_GAP.y)
      });
      if (!point) return {ok: false, reason: 'budget', nodes};
      const next = {...n, ...point};
      occupied.push(next);
      placed.set(n.id, next);
      bottom = Math.max(bottom, next.y + next.height);
    }
    groupY = bottom + COMPONENT_GAP;
  }
  return {ok: true, nodes: nodes.map(n => placed.get(n.id) ?? n), affectedIds: moving.map(n => n.id)};
}
