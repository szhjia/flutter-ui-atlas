import type {CanvasNode, EdgeSpec, Point, RoutedEdge} from './types';
import {expand, segmentHits} from './geometry';
import {
  EDGE_SEARCH_BUDGET,
  EDGE_SIBLING_OFFSET,
  EDGE_STUB_LENGTH,
  EDGE_TURN_COST,
  LOCAL_SCAN_MARGIN
} from './constants';
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const pathClear = (p: Point[], obstacles: ReturnType<typeof expand>[]) =>
  p.slice(1).every((b, i) => !obstacles.some(r => segmentHits(p[i], b, r)));
function simplify(points: Point[]) {
  return points.filter(
    (p, i) =>
      !i ||
      i === points.length - 1 ||
      !((points[i - 1].x === p.x && p.x === points[i + 1].x) || (points[i - 1].y === p.y && p.y === points[i + 1].y))
  );
}
function search(a: Point, b: Point, obs: ReturnType<typeof expand>[]): Point[] | null {
  const direct = [
    [a, {x: b.x, y: a.y}, b],
    [a, {x: a.x, y: b.y}, b]
  ];
  const local = obs.filter(
    r =>
      r.x <= Math.max(a.x, b.x) + LOCAL_SCAN_MARGIN &&
      r.x + r.width >= Math.min(a.x, b.x) - LOCAL_SCAN_MARGIN &&
      r.y <= Math.max(a.y, b.y) + LOCAL_SCAN_MARGIN &&
      r.y + r.height >= Math.min(a.y, b.y) - LOCAL_SCAN_MARGIN
  );
  for (const y of [...new Set(local.flatMap(r => [r.y, r.y + r.height]))].sort(
    (x, y) => Math.abs(x - a.y) - Math.abs(y - a.y)
  ))
    direct.push([a, {x: a.x, y}, {x: b.x, y}, b]);
  for (const x of [...new Set(local.flatMap(r => [r.x, r.x + r.width]))].sort(
    (x, y) => Math.abs(x - a.x) - Math.abs(y - a.x)
  ))
    direct.push([a, {x, y: a.y}, {x, y: b.y}, b]);
  const quick = direct
    .filter(p => pathClear(p, obs))
    .sort(
      (p, q) =>
        p.slice(1).reduce((s, v, i) => s + distance(p[i], v), 0) -
        q.slice(1).reduce((s, v, i) => s + distance(q[i], v), 0)
    )[0];
  if (quick) return simplify(quick);
  const xs = [...new Set([a.x, b.x, ...obs.flatMap(r => [r.x, r.x + r.width])])].sort((a, b) => a - b),
    ys = [...new Set([a.y, b.y, ...obs.flatMap(r => [r.y, r.y + r.height])])].sort((a, b) => a - b);
  type State = {x: number; y: number; dir: number; cost: number; score: number; prev?: State};
  const heap: State[] = [];
  const push = (s: State) => {
    heap.push(s);
    let i = heap.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].score <= s.score) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = s;
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let j = i * 2 + 1;
        if (j + 1 < heap.length && heap[j + 1].score < heap[j].score) j++;
        if (heap[j].score >= last.score) break;
        heap[i] = heap[j];
        i = j;
      }
      heap[i] = last;
    }
    return first;
  };
  push({x: xs.indexOf(a.x), y: ys.indexOf(a.y), dir: 0, cost: 0, score: distance(a, b)});
  const best = new Map<string, number>();
  let visits = 0;
  while (heap.length && visits++ < EDGE_SEARCH_BUDGET) {
    const s = pop(),
      p = {x: xs[s.x], y: ys[s.y]};
    if (p.x === b.x && p.y === b.y) {
      const path: Point[] = [];
      let t: State | undefined = s;
      while (t) {
        path.unshift({x: xs[t.x], y: ys[t.y]});
        t = t.prev;
      }
      return simplify(path);
    }
    for (const [dx, dy, dir] of [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 2],
      [0, -1, 2]
    ]) {
      const x = s.x + dx,
        y = s.y + dy;
      if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
      const q = {x: xs[x], y: ys[y]};
      if (obs.some(r => segmentHits(p, q, r))) continue;
      const cost = s.cost + distance(p, q) + (s.dir && s.dir !== dir ? EDGE_TURN_COST : 0),
        key = `${x},${y},${dir}`;
      if ((best.get(key) ?? Infinity) <= cost) continue;
      best.set(key, cost);
      push({x, y, dir, cost, score: cost + distance(q, b), prev: s});
    }
  }
  return null;
}
export function routeEdges(
  nodes: CanvasNode[],
  edges: EdgeSpec[],
  previous: RoutedEdge[],
  changedIds: Set<string>
): RoutedEdge[] {
  const byId = new Map(nodes.map(n => [n.id, n])),
    old = new Map(previous.map(e => [e.id, e])),
    obstacles = nodes.map(n => ({...expand(n), id: n.id}));
  const ports = new Map<string, number>();
  for (const node of nodes) {
    for (const right of [false, true]) {
      const incident = edges
        .flatMap(edge => {
          const source = edge.source === node.id;
          if (!source && edge.target !== node.id) return [];
          const other = byId.get(source ? edge.target : edge.source);
          if (!other || other.x + other.width / 2 >= node.x + node.width / 2 !== right) return [];
          return [{edge, source, other}];
        })
        .sort((a, b) => a.other.y - b.other.y || a.edge.id.localeCompare(b.edge.id));
      const step = Math.min(EDGE_SIBLING_OFFSET, Math.max(1, node.height - 100) / Math.max(1, incident.length - 1));
      incident.forEach((item, i) =>
        ports.set(
          `${item.edge.id}:${item.source ? 'source' : 'target'}`,
          node.y + node.height / 2 + (i - (incident.length - 1) / 2) * step
        )
      );
    }
  }
  return [...edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e, index) => {
      const a = byId.get(e.source),
        b = byId.get(e.target),
        cached = old.get(e.id);
      if (!a || !b) return {id: e.id, points: [], status: 'unroutable'};
      if (
        cached?.status === 'routed' &&
        !changedIds.has(a.id) &&
        !changedIds.has(b.id) &&
        cached.points[0]?.y === ports.get(`${e.id}:source`) &&
        cached.points.at(-1)?.y === ports.get(`${e.id}:target`) &&
        pathClear(
          cached.points,
          obstacles.filter(n => changedIds.has(n.id) && n.id !== a.id && n.id !== b.id)
        )
      )
        return cached;
      const siblings = edges
        .filter(x => (x.source === a.id && x.target === b.id) || (x.target === a.id && x.source === b.id))
        .sort((a, b) => a.id.localeCompare(b.id));
      const offset = (siblings.findIndex(x => x.id === e.id) - (siblings.length - 1) / 2) * EDGE_SIBLING_OFFSET;
      if (a.id === b.id) {
        const p = [
          {x: a.x + a.width, y: a.y + 60},
          {x: a.x + a.width + 40 + (index % 3) * 12, y: a.y + 60},
          {x: a.x + a.width + 40 + (index % 3) * 12, y: a.y - 40},
          {x: a.x + a.width / 2, y: a.y - 40},
          {x: a.x + a.width / 2, y: a.y}
        ];
        return {
          id: e.id,
          points: pathClear(
            p,
            obstacles.filter(n => n.id !== a.id)
          )
            ? p
            : [],
          status: pathClear(
            p,
            obstacles.filter(n => n.id !== a.id)
          )
            ? 'routed'
            : 'unroutable'
        };
      }
      const right = b.x + b.width / 2 >= a.x + a.width / 2;
      const start = {x: right ? a.x + a.width : a.x, y: ports.get(`${e.id}:source`) ?? a.y + a.height / 2 + offset},
        end = {x: right ? b.x : b.x + b.width, y: ports.get(`${e.id}:target`) ?? b.y + b.height / 2 + offset};
      const out = {x: start.x + (right ? EDGE_STUB_LENGTH : -EDGE_STUB_LENGTH), y: start.y},
        into = {x: end.x + (right ? -EDGE_STUB_LENGTH : EDGE_STUB_LENGTH), y: end.y};
      if (
        !pathClear(
          [start, out],
          obstacles.filter(n => n.id !== a.id)
        ) ||
        !pathClear(
          [into, end],
          obstacles.filter(n => n.id !== b.id)
        )
      )
        return {id: e.id, points: [], status: 'unroutable'};
      const path = search(out, into, obstacles);
      return path
        ? {id: e.id, points: simplify([start, ...path, end]), status: 'routed'}
        : {id: e.id, points: [], status: 'unroutable'};
    });
}
