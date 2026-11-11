import type {LayoutHistory, LayoutDocument} from './types';
export function commitLayout(h: LayoutHistory, next: LayoutDocument): LayoutHistory {
  if (JSON.stringify(h.present) === JSON.stringify(next)) return h;
  return {present: structuredClone(next), past: [...h.past, structuredClone(h.present)].slice(-50), future: []};
}
export function undoLayout(h: LayoutHistory): LayoutHistory {
  return h.past.length ? {present: h.past.at(-1)!, past: h.past.slice(0, -1), future: [h.present, ...h.future]} : h;
}
export function redoLayout(h: LayoutHistory): LayoutHistory {
  return h.future.length
    ? {present: h.future[0], past: [...h.past, h.present].slice(-50), future: h.future.slice(1)}
    : h;
}
