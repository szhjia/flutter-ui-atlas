import type {Point, Size, CanvasNode} from './types';
import {DRAG_GAP, OBSTACLE_PADDING} from './constants';
export type Rect = Point & Size;
export const GAP = DRAG_GAP;
export const hasSpacingConflict = (a: Rect, b: Rect, gap = GAP) =>
  a.x < b.x + b.width + gap.x - 0.001 &&
  a.x + a.width + gap.x > b.x + 0.001 &&
  a.y < b.y + b.height + gap.y - 0.001 &&
  a.y + a.height + gap.y > b.y + 0.001;
export const expand = (r: Rect, p = OBSTACLE_PADDING): Rect => ({
  x: r.x - p,
  y: r.y - p,
  width: r.width + 2 * p,
  height: r.height + 2 * p
});
export const center = (r: Rect): Point => ({x: r.x + r.width / 2, y: r.y + r.height / 2});
export const finiteNode = (n: CanvasNode) =>
  [n.x, n.y, n.width, n.height].every(Number.isFinite) && n.width > 0 && n.height > 0;
export function segmentHits(a: Point, b: Point, r: Rect) {
  if (a.x === b.x)
    return (
      a.x > r.x + 0.001 &&
      a.x < r.x + r.width - 0.001 &&
      Math.max(a.y, b.y) > r.y + 0.001 &&
      Math.min(a.y, b.y) < r.y + r.height - 0.001
    );
  if (a.y === b.y)
    return (
      a.y > r.y + 0.001 &&
      a.y < r.y + r.height - 0.001 &&
      Math.max(a.x, b.x) > r.x + 0.001 &&
      Math.min(a.x, b.x) < r.x + r.width - 0.001
    );
  return true;
}
export function candidates(m: Rect, obstacle: Rect, gap = GAP): Point[] {
  return [
    {x: obstacle.x + obstacle.width + gap.x, y: m.y},
    {x: obstacle.x - m.width - gap.x, y: m.y},
    {x: m.x, y: obstacle.y + obstacle.height + gap.y},
    {x: m.x, y: obstacle.y - m.height - gap.y}
  ];
}
