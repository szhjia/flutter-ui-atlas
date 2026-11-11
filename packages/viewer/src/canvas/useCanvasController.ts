import {useEffect, useRef, useState} from 'react';
import type {AppMapManifest} from '../model';
import type {CanvasNode, LayoutDocument, LayoutHistory, Point, Size, Viewport} from './types';
import {solveDrag} from './solve-drag';
import {arrangeNodes} from './arrange';
import {reconcileLayout} from './reconcile';
import {commitLayout, undoLayout, redoLayout} from './layout-state';
import {readLayout, writeLayout, discardLayout, storageKey} from './layout-storage';
import {DEFAULT_NODE_SIZE} from './constants';

export function isEditingTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest('input,textarea,select,iframe,[contenteditable=true],[role="combobox"]')
  );
}
export function useCanvasController({
  map,
  layoutKey = '',
  visibleIds
}: {
  map: AppMapManifest;
  layoutKey?: string;
  visibleIds: Set<string>;
}) {
  const sizes = useRef<Record<string, Size>>({});
  const shape = () =>
    map.screens.map(s => ({
      id: s.id,
      x: 0,
      y: 0,
      locked: false,
      hidden: !visibleIds.has(s.id),
      ...(sizes.current[s.id] ?? DEFAULT_NODE_SIZE)
    }));
  const read = () => {
    try {
      return readLayout(window.localStorage, layoutKey);
    } catch {
      return {document: null, issue: '布局未保存：浏览器存储不可用', writable: false, corrupted: false};
    }
  };
  const initial = useRef<ReturnType<typeof read> | null>(null);
  if (!initial.current) initial.current = read();
  const initialLayout = useRef<ReturnType<typeof reconcileLayout> | null>(null);
  if (!initialLayout.current) initialLayout.current = reconcileLayout(initial.current.document, shape(), map.edges);
  const [history, setHistory] = useState<LayoutHistory>(() => ({
    present: initialLayout.current!.document,
    past: [],
    future: []
  }));
  const current = useRef(history);
  current.current = history;
  const [preview, setPreview] = useState<CanvasNode[] | null>(null);
  const [pendingIds, setPending] = useState<string[]>(initialLayout.current.pendingIds),
    pending = useRef<string[]>(initialLayout.current.pendingIds);
  const [conflictIds, setConflicts] = useState<string[]>(initialLayout.current.conflictIds),
    [issue, setIssue] = useState(initial.current.issue);
  const [corrupted, setCorrupted] = useState(initial.current.corrupted);
  const [externalAvailable, setExternal] = useState(false),
    external = useRef(false);
  const [draggingId, setDragging] = useState<string | null>(null);
  const gesture = useRef<{id: string; start: CanvasNode[]} | null>(null),
    frame = useRef(0),
    target = useRef<Point | null>(null);
  const previous = useRef(new Set(map.screens.map(s => s.id))),
    context = useRef({map, key: layoutKey});
  const nodesFor = (d: LayoutDocument) =>
    shape()
      .filter(n => !pending.current.includes(n.id) && d.nodes[n.id])
      .map(n => ({...n, ...d.nodes[n.id]}));
  const save = (d: LayoutDocument) => {
    if (external.current) {
      setIssue('另一窗口有新布局；载入或保留当前布局后再保存');
      return;
    }
    try {
      setIssue(writeLayout(localStorage, layoutKey, d).issue);
    } catch {
      setIssue('布局未保存：浏览器存储不可用');
    }
  };
  const install = (h: LayoutHistory, persist = true) => {
    current.current = h;
    setHistory(h);
    if (persist) save(h.present);
  };
  const cancelDrag = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    gesture.current = null;
    target.current = null;
    setPreview(null);
    setDragging(null);
  };
  const reconcile = (d: LayoutDocument | null, ids?: Set<string>) => {
    const currentIds = ids ? new Set([...ids].filter(id => !pending.current.includes(id))) : ids;
    const r = reconcileLayout(d, shape(), map.edges, currentIds);
    pending.current = r.pendingIds;
    setPending(r.pendingIds);
    setConflicts(r.conflictIds);
    return r.document;
  };
  useEffect(() => {
    if (context.current.map === map && context.current.key === layoutKey) return;
    cancelDrag();
    const keyChanged = context.current.key !== layoutKey;
    let fresh: ReturnType<typeof read> | null = null;
    if (keyChanged) {
      external.current = false;
      setExternal(false);
      fresh = read();
      setIssue(fresh.issue);
      setCorrupted(fresh.corrupted);
    }
    const d = reconcile(fresh ? fresh.document : current.current.present, fresh ? undefined : previous.current);
    previous.current = new Set(map.screens.map(s => s.id));
    context.current = {map, key: layoutKey};
    install({present: d, past: [], future: []});
  }, [map, layoutKey]);
  useEffect(() => {
    save(current.current.present);
  }, []);
  useEffect(() => {
    const listener = (e: StorageEvent) => {
      if (layoutKey && (e.key === storageKey(layoutKey) || e.key === null)) {
        external.current = true;
        setExternal(true);
      }
    };
    window.addEventListener('storage', listener);
    return () => {
      window.removeEventListener('storage', listener);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [layoutKey]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current && !isEditingTarget(e.target)) {
        e.preventDefault();
        cancelDrag();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const commitNodes = (ns: CanvasNode[]) => {
    const d = structuredClone(current.current.present);
    for (const n of ns) d.nodes[n.id] = {x: n.x, y: n.y, locked: n.locked};
    const next = reconcile(d, new Set(previous.current));
    install(commitLayout(current.current, next));
  };
  const onDragStart = (id: string) => {
    cancelDrag();
    const start = nodesFor(current.current.present),
      n = start.find(n => n.id === id);
    if (!n || n.locked || n.hidden) return;
    gesture.current = {id, start};
    setDragging(id);
  };
  const onDrag = (id: string, p: Point) => {
    if (gesture.current?.id !== id) return;
    target.current = p;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (!gesture.current || !target.current) return;
      const r = solveDrag(gesture.current.start, id, target.current);
      setPreview(r.ok ? r.nodes : gesture.current.start);
      setIssue(r.ok ? null : '此处空间不足，松手将恢复原布局');
    });
  };
  const onDragStop = (id: string, p: Point) => {
    if (gesture.current?.id !== id) return;
    const r = solveDrag(gesture.current.start, id, p);
    cancelDrag();
    if (r.ok) commitNodes(r.nodes);
    else setIssue('此处空间不足，已恢复整个拖动前的布局');
  };
  const moveByKeyboard = (id: string, delta: Point) => {
    const n = nodesFor(current.current.present).find(n => n.id === id);
    if (!n) return;
    onDragStart(id);
    onDragStop(id, {x: n.x + delta.x, y: n.y + delta.y});
  };
  const toggleLock = (id: string) => {
    cancelDrag();
    const d = structuredClone(current.current.present);
    if (!d.nodes[id]) return;
    d.nodes[id].locked = !d.nodes[id].locked;
    const ids = new Set(previous.current);
    pending.current.forEach(id => ids.delete(id));
    install(commitLayout(current.current, reconcile(d, ids)));
  };
  const undo = () => {
    cancelDrag();
    const h = undoLayout(current.current);
    h.present = reconcile(h.present, previous.current);
    install(h);
  };
  const redo = () => {
    cancelDrag();
    const h = redoLayout(current.current);
    h.present = reconcile(h.present, previous.current);
    install(h);
  };
  const arrangeVisible = () => {
    cancelDrag();
    const r = arrangeNodes(nodesFor(current.current.present), map.edges, visibleIds);
    if (r.ok) commitNodes(r.nodes);
    else setIssue('没有足够空间整理，布局未更改');
  };
  const loadExternalLayout = () => {
    cancelDrag();
    const value = read();
    if (!value.document) {
      setIssue(value.issue ?? '外部布局已删除；当前布局仍保留');
      return;
    }
    external.current = false;
    setExternal(false);
    setIssue(value.issue);
    install({present: reconcile(value.document, previous.current), past: [], future: []}, false);
  };
  const keepLocalLayout = () => {
    external.current = false;
    setExternal(false);
    save(current.current.present);
  };
  const discardCorruptedLayout = () => {
    cancelDrag();
    const check = read();
    // 丢弃前重读：另一窗口可能已把存储修复为合法布局，此时不删数据，转回外部布局选择（置外部可用，让文案承诺的按钮真实出现）。
    if (check.document) {
      setCorrupted(false);
      external.current = true;
      setExternal(true);
      setIssue('布局数据已可读：请载入外部布局或保留当前布局。');
      return;
    }
    const discarded = discardLayout(localStorage, layoutKey);
    if (!discarded.ok) {
      setIssue(discarded.issue);
      return;
    }
    const fresh = read();
    setCorrupted(fresh.corrupted);
    external.current = false;
    setExternal(false);
    install({present: reconcile(null), past: [], future: []});
    setIssue(fresh.issue);
  };
  const onViewportCommit = (viewport: Viewport) => {
    const h = {...current.current, present: {...current.current.present, viewport}};
    install(h);
  };
  const onMeasured = (measurements: {id: string; size: Size}[]) => {
    let changed = false;
    for (const {id, size} of measurements) {
      const old = sizes.current[id];
      if (size.width > 0 && size.height > 0 && (!old || old.width !== size.width || old.height !== size.height)) {
        sizes.current[id] = size;
        changed = true;
      }
    }
    if (changed) {
      cancelDrag();
      install({...current.current, present: reconcile(current.current.present, previous.current)}, false);
    }
  };
  return {
    nodes:
      (context.current.map === map && context.current.key === layoutKey ? preview : null) ?? nodesFor(history.present),
    viewport: history.present.viewport,
    pendingIds,
    conflictIds,
    issue,
    corrupted,
    externalAvailable,
    draggingId,
    canUndo: !!history.past.length,
    canRedo: !!history.future.length,
    onDragStart,
    onDrag,
    onDragStop,
    cancelDrag,
    moveByKeyboard,
    toggleLock,
    undo,
    redo,
    arrangeVisible,
    loadExternalLayout,
    keepLocalLayout,
    discardCorruptedLayout,
    onViewportCommit,
    onMeasured
  };
}
