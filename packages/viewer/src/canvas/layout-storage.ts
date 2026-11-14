import type {LayoutDocument} from './types';
import {clampZoom} from './viewport';
export const storageKey = (key: string) => `flutter-ui-atlas:layout:v1:${key}`;
function valid(d: any): d is LayoutDocument {
  return (
    d?.schemaVersion === 1 &&
    [d.catalogIds, d.pendingIds].every(
      ids => ids === undefined || (Array.isArray(ids) && ids.every(id => typeof id === 'string'))
    ) &&
    d.nodes &&
    typeof d.nodes === 'object' &&
    !Array.isArray(d.nodes) &&
    Object.values(d.nodes).every(
      (n: any) => n && Number.isFinite(n.x) && Number.isFinite(n.y) && typeof n.locked === 'boolean'
    ) &&
    d.viewport &&
    [d.viewport.x, d.viewport.y, d.viewport.zoom].every(Number.isFinite) &&
    d.viewport.zoom > 0
  );
}
export interface LayoutReadResult {
  document: LayoutDocument | null;
  issue: string | null;
  writable: boolean;
  /** true = 存储里有数据但不可读或无效，可显式丢弃；存储本身不可用不算损坏 */ corrupted: boolean;
}
export function readLayout(storage: Storage, key: string): LayoutReadResult {
  if (!key)
    return {
      document: null,
      issue: 'No layout key configured. Changes last for this session only.',
      writable: false,
      corrupted: false
    };
  let value: string | null;
  try {
    value = storage.getItem(storageKey(key));
  } catch {
    return {
      document: null,
      issue: 'Layout not saved: browser storage is unavailable.',
      writable: false,
      corrupted: false
    };
  }
  if (!value) return {document: null, issue: null, writable: true, corrupted: false};
  try {
    const document = JSON.parse(value);
    if (!valid(document)) throw Error('Unsupported layout version or invalid data');
    document.viewport.zoom = clampZoom(document.viewport.zoom);
    return {document, issue: null, writable: true, corrupted: false};
  } catch {
    return {
      document: null,
      issue: 'Layout data is damaged. Using an automatic layout. Discard the damaged data to resume saving.',
      writable: false,
      corrupted: true
    };
  }
}
export function discardLayout(storage: Storage, key: string): {ok: boolean; issue: string | null} {
  if (!key) return {ok: false, issue: 'No layout key configured; nothing to discard.'};
  try {
    storage.removeItem(storageKey(key));
    return {ok: true, issue: null};
  } catch {
    return {ok: false, issue: 'Layout not discarded: browser storage is unavailable.'};
  }
}
export function writeLayout(
  storage: Storage,
  key: string,
  document: LayoutDocument
): {ok: boolean; issue: string | null} {
  const current = readLayout(storage, key);
  if (!current.writable) return {ok: false, issue: current.issue};
  if (!valid(document)) return {ok: false, issue: 'Layout not saved: invalid layout data.'};
  try {
    storage.setItem(
      storageKey(key),
      JSON.stringify({...document, viewport: {...document.viewport, zoom: clampZoom(document.viewport.zoom)}})
    );
    return {ok: true, issue: null};
  } catch {
    return {ok: false, issue: 'Layout not saved: browser storage is unavailable or full.'};
  }
}
