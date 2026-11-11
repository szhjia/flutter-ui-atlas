import type {CanvasNode, Point, SolveResult} from './types';
import {candidates, center, finiteNode, hasSpacingConflict} from './geometry';
import {DRAG_DEPTH_LIMIT, DRAG_MAX_DISPLACED, DRAG_SEARCH_BUDGET} from './constants';

export function solveDrag(start: CanvasNode[], draggedId: string, target: Point): SolveResult {
  const original = start.find(n => n.id === draggedId);
  const fail = (reason: 'locked' | 'no-space' | 'budget'): SolveResult => ({ok: false, reason, nodes: start});
  if (!original || !start.every(finiteNode) || ![target.x, target.y].every(Number.isFinite)) return fail('no-space');
  if (original.locked || original.hidden) return fail('locked');
  const radius = 2 * Math.max(...start.map(n => Math.hypot(n.width, n.height))),
    desired = {...original, ...target},
    goal = center(desired);
  const fixed = start.filter(n => n.id !== draggedId && (n.locked || n.hidden));
  let targets = [target];
  if (fixed.some(n => hasSpacingConflict(desired, n))) {
    targets = fixed
      .flatMap(n => candidates(desired, n))
      .filter(
        p =>
          Math.hypot(p.x - target.x, p.y - target.y) <= radius &&
          !fixed.some(n => hasSpacingConflict({...original, ...p}, n))
      );
    targets.sort(
      (a, b) =>
        Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y) ||
        a.x - b.x ||
        a.y - b.y
    );
  }
  let visits = 0;
  const visited = new Set<string>();
  const dx = target.x - original.x,
    dy = target.y - original.y;
  function search(nodes: CanvasNode[], depth: number): CanvasNode[] | null {
    if (++visits > DRAG_SEARCH_BUDGET || depth > DRAG_DEPTH_LIMIT) return null;
    const key = nodes.map(n => `${n.id}:${n.x}:${n.y}`).join('|');
    if (visited.has(key)) return null;
    visited.add(key);
    const moved = nodes.filter(
      n =>
        n.id !== draggedId && (n.x !== start.find(s => s.id === n.id)!.x || n.y !== start.find(s => s.id === n.id)!.y)
    );
    if (
      moved.length > DRAG_MAX_DISPLACED ||
      moved.some(n => {
        const c = center(start.find(s => s.id === n.id)!);
        return Math.hypot(c.x - goal.x, c.y - goal.y) > radius;
      })
    )
      return null;
    const changed = new Set([draggedId, ...moved.map(n => n.id)]);
    let pair: [CanvasNode, CanvasNode] | undefined;
    const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length && !pair; i++)
      for (let j = i + 1; j < sorted.length; j++)
        if ((changed.has(sorted[i].id) || changed.has(sorted[j].id)) && hasSpacingConflict(sorted[i], sorted[j])) {
          pair = [sorted[i], sorted[j]];
          break;
        }
    if (!pair) return nodes;
    const [a, b] = pair;
    const choices = pair
      .filter(n => n.id !== draggedId && !n.locked && !n.hidden)
      .sort((a, b) => Number(changed.has(a.id)) - Number(changed.has(b.id)) || a.id.localeCompare(b.id));
    for (const moving of choices) {
      const obstacle = moving.id === a.id ? b : a,
        base = start.find(n => n.id === moving.id)!;
      const spots = candidates(moving, obstacle).sort((p, q) => {
        const priority = (r: Point) =>
          Math.abs(dx) >= Math.abs(dy) ? Number((r.x - moving.x) * dx <= 0) : Number((r.y - moving.y) * dy <= 0);
        return (
          priority(p) - priority(q) ||
          Math.hypot(p.x - base.x, p.y - base.y) - Math.hypot(q.x - base.x, q.y - base.y) ||
          p.x - q.x ||
          p.y - q.y
        );
      });
      for (const p of spots) {
        const result = search(
          nodes.map(n => (n.id === moving.id ? {...n, ...p} : n)),
          depth + 1
        );
        if (result) return result;
        if (visits > DRAG_SEARCH_BUDGET) return null;
      }
    }
    return null;
  }
  for (const p of targets) {
    const result = search(
      start.map(n => (n.id === draggedId ? {...n, ...p} : {...n})),
      0
    );
    if (result)
      return {
        ok: true,
        nodes: result,
        affectedIds: result
          .filter(
            n =>
              n.id !== draggedId &&
              (n.x !== start.find(s => s.id === n.id)!.x || n.y !== start.find(s => s.id === n.id)!.y)
          )
          .map(n => n.id)
          .sort()
      };
  }
  return fail(visits > DRAG_SEARCH_BUDGET ? 'budget' : 'no-space');
}
