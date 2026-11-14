import {accountWorkspaces, type AccountWorkspace} from './workspaces';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes
} from 'react';
import {PanelRight, RefreshCw} from 'lucide-react';
import {
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
  type Edge,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './app-map.css';
import {type AppMapManifest, type CaptureAttempt, type MapScreen, visibleEdges, visibleScreens} from './model';

import {useCanvasController, isEditingTarget} from './canvas/useCanvasController';
import {CANVAS_ZOOM} from './canvas/constants';
import {CanvasChrome} from './canvas/CanvasChrome';
import {useCanvasWorkspace} from './canvas/useCanvasWorkspace';
import {clampZoom, constrainViewport, fitViewport, panExtent} from './canvas/viewport';
import type {ArrangementMode} from './canvas/arrange';
import {CanvasToolbar} from './canvas/CanvasToolbar';
import {GroupSelect} from './canvas/GroupSelect';
import {HeaderMenu} from './header/HeaderMenu';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {NativeSelect, NativeSelectOption} from './components/ui/native-select';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from './components/ui/select';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from './components/ui/tooltip';
import {AtlasEdge} from './canvas/AtlasEdge';
import {EdgeLabels} from './canvas/EdgeLabels';
import {routeEdges} from './canvas/route-edges';
import type {CanvasNode, RoutedEdge} from './canvas/types';
import {
  assertManifest,
  createPreviewUrl,
  createManagedLiveAdapter,
  emptySnapshot,
  readSourceFingerprint,
  readViewerSnapshot,
  safeLink,
  type AtlasShellConfig,
  type AtlasViewerConfig,
  type ViewerSnapshot,
  type AtlasLiveSessionInput,
  type AtlasLiveSessionHandle,
  type AtlasLiveSessionStatus
} from './config';

export type {
  AtlasHeaderLink,
  AtlasPreviewConfig,
  AtlasShellConfig,
  AtlasViewerConfig,
  AtlasLiveSessionInput,
  AtlasLiveSessionHandle,
  AtlasLiveSessionStatus
} from './config';
type ScreenNode = Node<{screen: MapScreen; locked: boolean; ghost: boolean; toggle: () => void}, 'screen'>;
function ScreenCard({data, selected}: NodeProps<ScreenNode>) {
  const s = data.screen;
  if (data.ghost) return <div className="atlas-ghost">Filtered out · {s.title}</div>;
  return (
    <article className={`map-card ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <h2>
        <span title={s.pageName ?? s.title}>{s.pageName ?? s.title}</span>
        <button
          className="atlas-lock nodrag nopan"
          aria-label={`${data.locked ? 'Unlock ' : 'Lock '}${s.title}`}
          onClick={e => {
            e.stopPropagation();
            data.toggle();
          }}
        >
          {data.locked ? '●' : '○'}
        </button>
      </h2>
      <div className="map-card-route" title={s.route}>
        {s.route}
      </div>
      {s.image ? (
        <img src={s.image} alt={`${s.role} · ${s.title} screenshot`} draggable={false} />
      ) : (
        <div className="map-capture-error">
          {s.status === 'pending' ? 'Pending' : 'Capture failed'}
          <br />
          {s.error}
        </div>
      )}

      <Handle type="source" position={Position.Right} isConnectable={false} />
    </article>
  );
}
const MemoScreenCard = memo(
  ScreenCard,
  (a, b) =>
    a.selected === b.selected &&
    a.data.screen === b.data.screen &&
    a.data.locked === b.data.locked &&
    a.data.ghost === b.data.ghost &&
    a.data.toggle === b.data.toggle
);
const nodeTypes = {screen: MemoScreenCard};
const edgeTypes = {atlas: AtlasEdge};
export interface AtlasViewerAdapter {
  layoutKey?: string;
  loadManifest(): Promise<AppMapManifest>;
  loadLatestAttempt?(): Promise<CaptureAttempt | null>;
  previewUrl?(screen: MapScreen, sessionId: string): string | null;
  isolatedPreview?: boolean;
  openLiveSession?(input: AtlasLiveSessionInput): Promise<AtlasLiveSessionHandle>;
  closeLiveSession?(id: string): Promise<void>;
  liveSessionStatus?(): Promise<AtlasLiveSessionStatus>;
  sourceFingerprint?(): Promise<string | null>;
  workspaceFreshness?(accountId: string, revisionId: string): Promise<boolean | null>;
  title?: string;
  homeUrl?: string;
  captureHint?: string;
  sharedRoles?: readonly string[];
}

type ViewerPresentation = Omit<AtlasViewerAdapter, 'loadManifest' | 'loadLatestAttempt'> & {shell?: AtlasShellConfig};
type AtlasViewerProps = {adapter: AtlasViewerAdapter; config?: never} | {config: AtlasViewerConfig; adapter?: never};

function BrandLogo({url, text}: {url?: string; text?: string}) {
  const [failed, setFailed] = useState(false);
  const src = typeof url === 'string' && safeLink(url) && !failed ? url : undefined;
  return (
    <span className={`map-logo${src ? ' has-image' : ''}`} aria-hidden="true">
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : (text ?? 'A')}
    </span>
  );
}

function HeaderIconButton({label, children, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {label: string}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={props['aria-expanded'] ? 'secondary' : 'outline'}
          size="icon"
          className="map-header-icon"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ShellHeader({
  presentation,
  filters,
  actions
}: {
  presentation: ViewerPresentation;
  filters?: ReactNode;
  actions?: ReactNode;
}) {
  const shell = presentation.shell;
  const title = shell?.title ?? presentation.title ?? 'UI Atlas';
  const links = (
    shell?.headerLinks ?? (presentation.homeUrl ? [{label: 'Back to workspace ↗', href: presentation.homeUrl}] : [])
  ).filter(link => safeLink(link.href));
  return (
    <TooltipProvider delayDuration={350}>
      <header className="map-topbar">
        <div className="map-brand">
          <BrandLogo key={shell?.logoUrl} url={shell?.logoUrl} text={shell?.logoText} />
          <h1 title={title}>{title}</h1>
        </div>
        {filters && <div className="map-header-filters">{filters}</div>}
        {(actions || links.length > 0) && (
          <div className="map-header-actions">
            {actions}
            {links.length > 0 && (
              <HeaderMenu label="Links">
                <nav className="map-header-links" aria-label="Project links">
                  {links.map((link, index) => (
                    <Button key={index} asChild variant="ghost" className="justify-start">
                      <a href={link.href}>{link.label}</a>
                    </Button>
                  ))}
                </nav>
              </HeaderMenu>
            )}
          </div>
        )}
      </header>
    </TooltipProvider>
  );
}

const edgeColor = (status: string) => (status === 'observed' ? '#287d78' : status === 'failed' ? '#b75b48' : '#909aab');

function AttemptNotice({attempt, hasMap}: {attempt: CaptureAttempt | null; hasMap: boolean}) {
  if (attempt?.status !== 'failed') return null;
  return (
    <div className="atlas-notice" role="status">
      Latest capture failed{hasMap ? ' — showing the last successful map' : ''}. {attempt.error?.split('\n', 1)[0]}{' '}
      {attempt.report && safeLink(attempt.report) && (
        <a href={attempt.report} target="_blank" rel="noreferrer">
          View capture report ↗
        </a>
      )}
    </div>
  );
}

type CoverageView = 'flow' | 'unlinked' | 'all';

function MapCanvas({
  map,
  attempt,
  loadError,
  refresh,
  adapter,
  accounts,
  accountId,
  selectAccount
}: {
  accounts: AccountWorkspace[];
  accountId: string;
  selectAccount: (id: string) => void;
  map: AppMapManifest;
  attempt: CaptureAttempt | null;
  loadError: string;
  refresh: () => void;
  adapter: ViewerPresentation;
}) {
  const groupOrder = useMemo(() => [...new Set(map.screens.map(s => s.group))], [map]);
  const roles = useMemo(() => [...new Set(map.screens.map(s => s.role))], [map]);
  const compare = (a: MapScreen, b: MapScreen) =>
    roles.indexOf(a.role) - roles.indexOf(b.role) || groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group);

  const [role, setRole] = useState('全部');
  const [coverage, setCoverage] = useState<CoverageView>('flow');
  const [group, setGroup] = useState('全部');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState<{id: string; url: string} | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [managed, setManaged] = useState<{screenId: string; state: 'opening' | 'ready' | 'closed'} | null>(null);
  const pendingLive = useRef<{
    requestId: string;
    id?: string;
    controller: AbortController;
    adapter: ViewerPresentation;
  } | null>(null);
  const cancelManaged = useCallback((showClosed = false) => {
    const pending = pendingLive.current;
    pendingLive.current = null;
    if (pending) {
      pending.controller.abort();
      void pending.adapter.closeLiveSession?.(pending.id ?? pending.requestId).catch(() => {});
    }
    setManaged(previous => (showClosed && previous ? {...previous, state: 'closed'} : null));
  }, []);
  useEffect(() => {
    setManaged(null);
    return () => {
      const pending = pendingLive.current;
      pendingLive.current = null;
      pending?.controller.abort();
      if (pending) void pending.adapter.closeLiveSession?.(pending.id ?? pending.requestId).catch(() => {});
    };
  }, [adapter, map.captureId]);
  useEffect(() => {
    if (!adapter.liveSessionStatus || managed?.state !== 'ready') return;
    let current = true;
    const timer = window.setInterval(() => {
      const pending = pendingLive.current;
      if (!pending) return;
      void adapter.liveSessionStatus!()
        .then(status => {
          if (current && pendingLive.current === pending && (status.state !== 'ready' || status.id !== pending.id))
            cancelManaged(true);
        })
        .catch(() => {});
    }, 1000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [adapter, managed?.state, cancelManaged]);
  const refreshMap = () => {
    cancelManaged();
    setLive(null);
    refresh();
  };
  const [showEdges, setShowEdges] = useState(true);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const inspectorId = useId();
  const inspectorAction = collapsed ? 'Show details' : 'Hide details';
  const [source, setSource] = useState<string | null>(null);
  const [inputChanged, setInputChanged] = useState<boolean | null>(map.configurationChanged ?? null);

  const flow = useReactFlow<ScreenNode>();
  const workspace = useCanvasWorkspace(!!live);
  const [layoutMode, setLayoutMode] = useState<ArrangementMode>(() => {
    try {
      const saved = localStorage.getItem(`${adapter.layoutKey}:mode`);
      return saved === 'horizontal' || saved === 'vertical' ? saved : 'balanced';
    } catch {
      return 'balanced';
    }
  });
  useEffect(() => {
    let current = true;
    const check = async () => {
      if (map.schemaVersion === 2) {
        try {
          const changed = await adapter.workspaceFreshness?.(accountId, map.revisionId ?? '');
          if (current) setInputChanged(changed ?? map.configurationChanged ?? null);
        } catch {
          if (current) setInputChanged(null);
        }
      } else {
        try {
          const value = await adapter.sourceFingerprint?.();
          if (current) setSource(value ?? null);
        } catch {
          if (current) setSource(null);
        }
      }
    };
    void check();
    const timer = window.setInterval(check, 30000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [adapter, map.revisionId, accountId, map.configurationChanged, map.schemaVersion]);
  const verifiedIds = useMemo(
    () => new Set(map.edges.filter(edge => edge.status === 'observed').flatMap(edge => [edge.source, edge.target])),
    [map.edges]
  );
  const scope = !map.discovery || (coverage === 'flow' && !verifiedIds.size) ? 'all' : coverage;
  const scopedCount =
    scope === 'all' ? map.screens.length : scope === 'flow' ? verifiedIds.size : map.screens.length - verifiedIds.size;
  const screens = useMemo(
    () =>
      visibleScreens(map, role, group, query, adapter.sharedRoles)
        .filter(screen => scope === 'all' || verifiedIds.has(screen.id) === (scope === 'flow'))
        .sort(compare),
    [map, role, group, query, adapter.sharedRoles, scope, verifiedIds]
  );
  const selected = screens.find(s => s.id === selectedId) ?? null;
  const relations = map.edges.filter(e => e.source === selected?.id || e.target === selected?.id);
  const entrances = relations.filter(edge => edge.target === selected?.id && edge.status === 'observed');
  const visibleIds = useMemo(() => new Set(screens.map(s => s.id)), [screens]);
  const controller = useCanvasController({map, layoutKey: adapter.layoutKey, visibleIds});
  const {nodes: geometry} = controller;
  const extent = panExtent(geometry);
  const fit = (items = geometry) =>
    controller.onViewportCommit(
      constrainViewport(
        fitViewport(
          items.filter(n => !n.hidden),
          workspace.size
        ),
        workspace.size,
        panExtent(items)
      )
    );
  const arrange = (mode: ArrangementMode) => {
    const result = controller.arrangeVisible({
      mode,
      aspectRatio: workspace.size.width / Math.max(1, workspace.size.height)
    });
    if (result) fit(result);
  };
  const zoomTo = (zoom: number) => {
    const current = flow.getViewport();
    const nextZoom = clampZoom(zoom);
    const ratio = nextZoom / current.zoom;
    controller.onViewportCommit(
      constrainViewport(
        {
          x: workspace.size.width / 2 - (workspace.size.width / 2 - current.x) * ratio,
          y: workspace.size.height / 2 - (workspace.size.height / 2 - current.y) * ratio,
          zoom: nextZoom
        },
        workspace.size,
        extent
      )
    );
  };
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const toggles = useRef(new Map<string, () => void>());
  const lockAction = (id: string) => {
    if (!toggles.current.has(id)) toggles.current.set(id, () => controllerRef.current.toggleLock(id));
    return toggles.current.get(id)!;
  };
  const active = geometry.find(n => n.id === controller.draggingId);
  const nodeCache = useRef(new Map<string, ScreenNode>());
  const screenById = useMemo(() => new Map(map.screens.map(s => [s.id, s])), [map.screens]);
  const nodes: ScreenNode[] = geometry
    .filter(n => screenById.has(n.id) && (!n.hidden || (active && Math.hypot(n.x - active.x, n.y - active.y) < 1400)))
    .map(n => {
      const screen = screenById.get(n.id)!;
      const old = nodeCache.current.get(n.id);
      if (
        old &&
        old.data.screen === screen &&
        old.data.locked === n.locked &&
        old.data.ghost === n.hidden &&
        old.position.x === n.x &&
        old.position.y === n.y &&
        old.measured?.width === n.width &&
        old.measured?.height === n.height &&
        old.selected === (n.id === selectedId)
      )
        return old;
      const node: ScreenNode = {
        id: n.id,
        type: 'screen',
        data: {screen, locked: n.locked, ghost: n.hidden, toggle: lockAction(n.id)},
        position: {x: n.x, y: n.y},
        measured: {width: n.width, height: n.height},
        selected: n.id === selectedId,
        draggable: !n.locked && !n.hidden,
        selectable: !n.hidden,
        focusable: !n.hidden,
        style: n.hidden ? {width: n.width, height: n.height, pointerEvents: 'none'} : undefined
      };
      nodeCache.current.set(n.id, node);
      return node;
    });
  const shownEdges = useMemo(
    () =>
      showEdges ? visibleEdges(map.edges, screens).filter(edge => scope !== 'flow' || edge.status === 'observed') : [],
    [showEdges, map.edges, screens, scope]
  );
  const cache = useRef<{nodes: CanvasNode[]; routes: RoutedEdge[]; signature: string}>({
    nodes: [],
    routes: [],
    signature: ''
  });
  const signature = shownEdges.map(e => `${e.id}:${e.source}:${e.target}`).join('|');
  const changedIds = new Set(
    geometry
      .filter(n => {
        const old = cache.current.nodes.find(o => o.id === n.id);
        return !old || old.x !== n.x || old.y !== n.y || old.width !== n.width || old.height !== n.height;
      })
      .map(n => n.id)
  );
  const routes = routeEdges(
    geometry,
    shownEdges,
    cache.current.signature === signature ? cache.current.routes : [],
    changedIds
  );
  cache.current = {nodes: geometry, routes, signature};
  const edgeCache = useRef(new Map<string, Edge>());
  const routeById = new Map(routes.map(r => [r.id, r]));
  const edges: Edge[] = shownEdges.map(e => {
    const points = routeById.get(e.id)?.points,
      color = edgeColor(e.status),
      width = e.id === selectedEdge ? 2.5 : 1.5,
      dash = e.status === 'observed' ? undefined : '6 5';
    const old = edgeCache.current.get(e.id);
    if (
      old &&
      old.source === e.source &&
      old.target === e.target &&
      old.data?.points === points &&
      old.style?.stroke === color &&
      old.style?.strokeWidth === width &&
      old.style?.strokeDasharray === dash
    )
      return old;
    const edge: Edge = {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'atlas',
      data: {points},
      markerEnd: {type: MarkerType.Arrow, color},
      style: {stroke: color, strokeWidth: width, strokeDasharray: dash}
    };
    edgeCache.current.set(e.id, edge);
    return edge;
  });
  const focusedIds = new Set(
    shownEdges.filter(e => e.id === selectedEdge || e.source === selectedId || e.target === selectedId).map(e => e.id)
  );
  useEffect(() => {
    void flow.setViewport(constrainViewport(controller.viewport, workspace.size, extent));
  }, [
    controller.viewport.x,
    controller.viewport.y,
    controller.viewport.zoom,
    workspace.size.width,
    workspace.size.height,
    extent[0][0],
    extent[0][1],
    extent[1][0],
    extent[1][1]
  ]);
  const edgeDetail = map.edges.find(e => e.id === selectedEdge);
  const choose = useCallback(
    (id: string) => {
      cancelManaged();
      setSelectedId(id);
      setSelectedEdge(null);
      setLive(null);
      setPreviewError('');
    },
    [cancelManaged]
  );
  const resetFilters = (nextRole: string, nextGroup: string, nextQuery: string) => {
    cancelManaged();
    setRole(nextRole);
    setGroup(nextGroup);
    setQuery(nextQuery);
    setSelectedId(null);
    setLive(null);
  };
  const stale =
    inputChanged === true || (map.schemaVersion === 1 && source !== null && source !== map.sourceFingerprint);
  async function openPreview(screen: MapScreen) {
    cancelManaged();
    setPreviewError('');
    if (adapter.openLiveSession && adapter.closeLiveSession) {
      const requestId = `map-live-${crypto.randomUUID()}`;
      const pending = {requestId, controller: new AbortController(), adapter, id: undefined as string | undefined};
      pendingLive.current = pending;
      setManaged({screenId: screen.id, state: 'opening'});
      setLive(null);
      try {
        const handle = await adapter.openLiveSession({
          screenId: screen.id,
          captureId: map.captureId,
          requestId,
          signal: pending.controller.signal
        });
        if (pendingLive.current !== pending) {
          void adapter.closeLiveSession(handle.id).catch(() => {});
          return;
        }
        pending.id = handle.id;
        setManaged({screenId: screen.id, state: 'ready'});
      } catch (error) {
        if (pendingLive.current !== pending) return;
        cancelManaged();
        setPreviewError(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    try {
      const url = adapter.previewUrl?.(screen, `map-live-${crypto.randomUUID()}`);
      if (!url) throw Error('No live preview URL is configured for this screen.');
      setLive({id: screen.id, url});
      setPreviewError('');
    } catch (error) {
      setPreviewError(String(error instanceof Error ? error.message : error));
    }
  }
  return (
    <main
      className="app-map"
      onKeyDownCapture={e => {
        if (
          isEditingTarget(e.target) ||
          (e.target instanceof Element &&
            e.target.closest('.map-topbar, [data-atlas-header], [data-atlas-canvas-controls]'))
        )
          return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          controller.cancelDrag();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          e.stopPropagation();
          e.shiftKey ? controller.redo() : controller.undo();
          return;
        }
        if (selectedId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          controller.moveByKeyboard(selectedId, {
            x: e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0,
            y: e.key === 'ArrowUp' ? -10 : e.key === 'ArrowDown' ? 10 : 0
          });
        }
      }}
    >
      <ShellHeader
        presentation={adapter}
        filters={
          <>
            <Input
              className="map-header-search"
              aria-label="Search screens"
              placeholder="Search screens or routes…"
              value={query}
              onChange={event => resetFilters(role, group, event.target.value)}
            />
            <Select value={accountId} onValueChange={selectAccount}>
              <SelectTrigger
                className="map-account-select"
                aria-label="Account"
                title={accounts.find(a => a.id === accountId)?.name}
              >
                <SelectValue className="min-w-0 flex-1 text-left" />
              </SelectTrigger>
              <SelectContent
                data-atlas-header
                aria-label="Accounts"
                position="popper"
                align="start"
                collisionPadding={12}
                className="max-w-[min(24rem,calc(100vw-24px))]"
              >
                <SelectGroup>
                  {accounts.map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                      {accounts.filter(a => a.name === item.name).length > 1 ? ` · ${item.id.slice(-8)}` : ''}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="map-header-group">
              <GroupSelect groups={groupOrder} value={group} onChange={value => resetFilters(role, value, query)} />
            </div>
            {map.discovery && (
              <NativeSelect
                className="map-coverage-select"
                aria-label="Screen coverage"
                value={scope}
                onChange={event => {
                  setCoverage(event.target.value as CoverageView);
                  setSelectedEdge(null);
                  resetFilters(role, group, query);
                }}
              >
                <NativeSelectOption value="flow" disabled={!verifiedIds.size}>
                  Verified flow ({verifiedIds.size})
                </NativeSelectOption>
                <NativeSelectOption value="unlinked">
                  Unlinked screens ({map.screens.length - verifiedIds.size})
                </NativeSelectOption>
                <NativeSelectOption value="all">All screens ({map.screens.length})</NativeSelectOption>
              </NativeSelect>
            )}
          </>
        }
        actions={
          <>
            <HeaderIconButton label="Refresh captures" onClick={refreshMap}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
            </HeaderIconButton>

            <HeaderIconButton
              label={inspectorAction}
              aria-expanded={!collapsed}
              aria-controls={inspectorId}
              onClick={() => setCollapsed(value => !value)}
            >
              <PanelRight data-icon="inline-start" aria-hidden="true" />
            </HeaderIconButton>
          </>
        }
      />
      <AttemptNotice attempt={attempt} hasMap />
      {loadError && (
        <div className="atlas-notice" role="alert">
          Could not load captures; showing the last successful map. {loadError.split('\n', 1)[0]}{' '}
          <button onClick={refreshMap}>Retry</button>
        </div>
      )}
      {(controller.issue ||
        controller.externalAvailable ||
        controller.pendingIds.length > 0 ||
        controller.conflictIds.length > 0) && (
        <div className="atlas-notice" role="status">
          {controller.issue}{' '}
          {controller.corrupted && <button onClick={controller.discardCorruptedLayout}>Discard damaged layout</button>}
          {controller.conflictIds.length > 0 &&
            `${controller.conflictIds.length} resized screens need more space. Move or arrange them.`}
          {controller.externalAvailable && (
            <>
              <span>Another window updated the layout.</span>
              <button onClick={controller.loadExternalLayout}>Load external layout</button>
              <button onClick={controller.keepLocalLayout}>Keep current layout</button>
            </>
          )}
          {controller.pendingIds.map(id => (
            <span key={id}>
              Needs placement: {map.screens.find(s => s.id === id)?.title}
              <button onClick={() => controller.toggleLock(id)}>Unlock and place</button>
            </span>
          ))}
        </div>
      )}
      <div className="map-main" ref={workspace.main}>
        <section className="map-stage" aria-label="Screen map" ref={workspace.stage}>
          <ReactFlow<ScreenNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={CANVAS_ZOOM.min}
            maxZoom={CANVAS_ZOOM.max}
            translateExtent={extent}
            onNodesChange={changes => {
              controller.onMeasured(
                changes.flatMap(c => (c.type === 'dimensions' && c.dimensions ? [{id: c.id, size: c.dimensions}] : []))
              );
              const selection = changes.find(c => c.type === 'select' && c.selected);
              if (selection?.type === 'select') choose(selection.id);
            }}
            ariaLabelConfig={{
              'controls.ariaLabel': 'Canvas controls',
              'controls.zoomIn.ariaLabel': 'Zoom in',
              'controls.zoomOut.ariaLabel': 'Zoom out',
              'controls.fitView.ariaLabel': 'Fit view',
              'minimap.ariaLabel': 'Screen minimap',
              'handle.ariaLabel': 'Screen handle',
              'node.a11yDescription.default':
                'Press Enter to select a screen, arrow keys to move, and Escape to cancel.',
              'edge.a11yDescription.default': 'Navigation between screens.'
            }}
            defaultViewport={controller.viewport}
            onMoveEnd={(_, viewport) =>
              controller.onViewportCommit(constrainViewport(viewport, workspace.size, extent))
            }
            nodesConnectable={false}
            deleteKeyCode={null}
            onNodeClick={(_, node) => choose(node.id)}
            onNodeDragStart={(_, node) => controller.onDragStart(node.id)}
            onNodeDrag={(_, node) => {
              if (node) controller.onDrag(node.id, node.position);
            }}
            onNodeDragStop={(_, node) => {
              if (node) controller.onDragStop(node.id, node.position);
            }}
            onEdgeClick={(_, edge) => setSelectedEdge(edge.id)}

            onPaneClick={() => {
              setSelectedId(null);
              setLive(null);
              cancelManaged();
            }}
          >
            {showEdges && (
              <EdgeLabels
                routes={routes}
                nodes={geometry}
                edges={shownEdges}
                focusedIds={focusedIds}
                onChoose={setSelectedEdge}
              />
            )}
            <Background color="#d6dce5" gap={24} size={1} />
            <MiniMap
              style={{width: 110, height: 74}}
              pannable
              zoomable
              nodeColor={n => ['#81a8cd', '#d8ba77', '#91b4aa'][roles.indexOf((n.data.screen as MapScreen).role) % 3]}
            />
          </ReactFlow>
          {!screens.length && <div className="map-no-results">No matching screens. Adjust the filters.</div>}
          <CanvasChrome
            mode={layoutMode}
            onModeChange={mode => {
              setLayoutMode(mode);
              try {
                localStorage.setItem(`${adapter.layoutKey}:mode`, mode);
              } catch {
                /* Layout remains usable without storage. */
              }
              arrange(mode);
            }}
            layoutTools={
              <CanvasToolbar
                canUndo={controller.canUndo}
                canRedo={controller.canRedo}
                undo={controller.undo}
                redo={controller.redo}
                arrange={() => arrange(layoutMode)}
                count={geometry.filter(n => !n.hidden && !n.locked).length}
                locked={geometry.find(n => n.id === selectedId)?.locked}
                onLock={selectedId ? () => controller.toggleLock(selectedId) : undefined}
              />
            }
            zoom={controller.viewport.zoom}
            onZoom={zoomTo}
            onFit={() => fit()}
            showEdges={showEdges}
            onShowEdges={setShowEdges}
            unroutable={routes.filter(r => r.status === 'unroutable').length}
          />
        </section>
        {!collapsed && (
          <div
            className="map-inspector-resize"
            role="separator"
            aria-label="Resize details panel"
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={workspace.maxWidth}
            aria-valuenow={workspace.inspectorWidth}
            tabIndex={0}
            data-atlas-canvas-controls
            style={{right: workspace.inspectorWidth - 4}}
            {...workspace.resizeProps}
          />
        )}
        <aside
          id={inspectorId}
          hidden={collapsed}
          className={`map-inspector ${live ? 'map-inspector-live' : ''}`}
          style={{width: workspace.inspectorWidth}}
        >
          {edgeDetail && (
            <div className="atlas-edge-detail">
              <h3>Navigation</h3>
              <b>
                {map.screens.find(s => s.id === edgeDetail.source)?.title} →{' '}
                {map.screens.find(s => s.id === edgeDetail.target)?.title}
              </b>
              <p>
                {edgeDetail.action}
                {edgeDetail.recordingSources?.length
                  ? ` · ${edgeDetail.recordingSources.map(source => (source === 'manual' ? 'Manual recording' : 'Test recording')).join(', ')}`
                  : ''}
              </p>
              <span>
                {edgeDetail.status === 'observed'
                  ? 'Verified by interaction'
                  : edgeDetail.status === 'failed'
                    ? 'Verification failed'
                    : 'Declared, unverified'}
              </span>
              <button onClick={() => setSelectedEdge(null)}>Close transition</button>
            </div>
          )}
          {selected ? (
            <>
              <div className="map-inspector-heading">
                <span>
                  {selected.role} / {selected.group}
                </span>
                <button
                  aria-label="Close screen details"
                  onClick={() => {
                    setSelectedId(null);
                    setLive(null);
                    cancelManaged();
                  }}
                >
                  ×
                </button>
              </div>
              <h2>{selected.pageName ?? selected.title}</h2>
              <p>{selected.pageName ? 'Declared page name' : 'Page title'}</p>
              <code>{selected.route}</code>
              {map.discovery && (
                <div className="map-muted">
                  <p>Screen source: {selected.discoverySource || 'Browser observation'}</p>
                  <p>App entry: {selected.entry}</p>
                  <p>
                    {entrances.length
                      ? `${entrances.length} verified entry paths`
                      : selected.status === 'captured'
                        ? 'Screenshot captured; no verified entry path yet'
                        : 'Pending candidate; no verified entry path yet'}
                  </p>
                </div>
              )}
              <div className="map-preview-tabs">
                <button
                  aria-pressed={!live && !managed}
                  onClick={() => {
                    cancelManaged();
                    setLive(null);
                    setPreviewError('');
                  }}
                >
                  Captured screenshot
                </button>
                {(adapter.previewUrl || (adapter.openLiveSession && adapter.closeLiveSession)) &&
                  (!map.discovery || selected.status === 'captured') && (
                    <button
                      aria-pressed={
                        live?.id === selected.id || (managed?.screenId === selected.id && managed.state !== 'closed')
                      }
                      onClick={() => openPreview(selected)}
                    >
                      Open live session
                    </button>
                  )}
              </div>
              {managed?.screenId === selected.id && (
                <p role="status">
                  {managed.state === 'opening'
                    ? 'Preparing a separate Chrome session…'
                    : managed.state === 'ready'
                      ? 'Opened in a separate Chrome window. Interact with the app there.'
                      : 'Live session closed.'}{' '}
                  {managed.state !== 'closed' && (
                    <button onClick={() => cancelManaged(true)}>Close live session</button>
                  )}
                </p>
              )}
              {previewError && <p role="alert">{previewError}</p>}
              {live?.id === selected.id ? (
                <>
                  <p className="map-live-hint">
                    {adapter.isolatedPreview ? 'Isolated demo session' : 'Live web preview'} · {map.viewport.width} ×{' '}
                    {map.viewport.height}
                    <br />
                    The app server must be running. Selecting another screen closes this preview.
                  </p>
                  <div
                    className="map-live-box"
                    style={{width: map.viewport.width + 2, height: map.viewport.height + 2}}
                  >
                    <iframe
                      style={{width: map.viewport.width, height: map.viewport.height}}
                      title={`${selected.title} live preview`}
                      src={live.url}
                    />
                  </div>
                  <a className="map-open" href={live.url} target="_blank" rel="noreferrer">
                    Open in a separate window ↗
                  </a>
                </>
              ) : selected.image ? (
                <a href={selected.image} target="_blank" rel="noreferrer">
                  <img className="map-detail-image" src={selected.image} alt={`${selected.title} full screenshot`} />
                </a>
              ) : (
                <p role={selected.status === 'failed' ? 'alert' : undefined}>
                  {selected.status === 'pending' ? 'Pending · ' : ''}
                  {selected.error}
                </p>
              )}
              <h3>Screen connections · {relations.length}</h3>
              {relations.length ? (
                relations.map(edge => {
                  const target = map.screens.find(
                    s => s.id === (edge.source === selected.id ? edge.target : edge.source)
                  );
                  return (
                    <button
                      className="map-relation"
                      key={edge.id}
                      title={edge.reason ?? edge.sourceFile}
                      onClick={() => {
                        if (target) {
                          setQuery('');
                          setGroup('全部');

                          if (scope !== 'all' && verifiedIds.has(target.id) !== (scope === 'flow')) setCoverage('all');
                          choose(target.id);
                          const p = geometry.find(n => n.id === target.id) ?? {x: 0, y: 0};
                          void flow.setCenter(p.x + 112, p.y + 250, {zoom: 0.75, duration: 300});
                        }
                      }}
                    >
                      <b>
                        {edge.source === selected.id ? '→' : '←'} {target?.title}
                      </b>
                      <span>
                        {edge.action} ·{' '}
                        {edge.status === 'observed'
                          ? 'Verified'
                          : edge.status === 'failed'
                            ? 'Verification failed'
                            : 'Unverified'}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="map-muted">
                  No connections recorded for this screen. A screenshot does not verify its entry flow.
                </p>
              )}
              <p className="map-muted">
                {!map.discovery && selected.discoverySource && `${selected.discoverySource} · `}
                {selected.state} · {selected.capturedAt ? new Date(selected.capturedAt).toLocaleString('en-US') : ''}
              </p>
            </>
          ) : (
            <div className="map-intro">
              <span className="map-eyebrow">SCREEN FLOW</span>
              <h2>
                See the whole app,
                <br />
                in one place.
              </h2>
              <p>
                Cards show real Flutter screenshots. Select a screen to inspect its capture, connections, or live
                preview.
              </p>
              <ol>
                <li>Drag to pan; scroll to zoom</li>
                <li>Switch account workspaces or filter features</li>
                <li>Select a screen to inspect or open it</li>
              </ol>
              {adapter.shell?.introNote && <p className="atlas-intro-note">{adapter.shell.introNote}</p>}
              <div className="map-scope">
                <b>Capture scope</b>
                <p>{map.scope}</p>
                <p>
                  {map.discovery
                    ? 'Verified flow shows screens connected by recorded interactions. Choose Unlinked screens to see screenshot-only pages and pending candidates.'
                    : 'A screenshot does not verify a flow. The map shows discovered screens and recorded connections.'}
                </p>
                {Boolean(map.diagnostics?.length) && (
                  <details>
                    <summary>Capture notes · {map.diagnostics?.length}</summary>
                    <ul>
                      {map.diagnostics?.slice(0, 10).map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
      <footer className={`map-status ${stale || map.runtimeErrors?.length ? 'is-stale' : ''}`}>
        <span className="map-capture-summary">
          Showing {screens.length} / {scopedCount} · {map.screens.filter(screen => screen.status === 'captured').length}{' '}
          captured screens
          {map.discovery && ` · ${map.screens.filter(screen => screen.status === 'pending').length} pending`} ·{' '}
          {map.edges.filter(edge => edge.status === 'observed').length} verified transitions
        </span>
        <span>
          {map.runtimeErrors?.length ? `${map.runtimeErrors.length} runtime errors; see the capture report · ` : ''}
          {stale
            ? '● Inputs changed; capture again'
            : map.schemaVersion === 2
              ? inputChanged === false
                ? '● Inputs unchanged (runtime not verified)'
                : '● Input freshness not checked'
              : source
                ? '● Source unchanged since capture (build not verified)'
                : '● Source freshness not checked'}{' '}
          · {new Date(map.capturedAt).toLocaleString('en-US')}
        </span>
        <span>
          {map.schemaVersion === 2 && (map.reused ? 'Reused capture · ' : 'Saved capture · ')}
          {map.viewport.width} × {map.viewport.height} · {map.theme}
          {map.sourceFingerprint && ` · Fingerprint ${map.sourceFingerprint.slice(0, 10)}`}
        </span>
      </footer>
    </main>
  );
}

async function readAdapterSnapshot(adapter: AtlasViewerAdapter): Promise<ViewerSnapshot> {
  const [manifest, latest] = await Promise.allSettled([
    Promise.resolve().then(() => adapter.loadManifest()),
    Promise.resolve().then(() => adapter.loadLatestAttempt?.() ?? null)
  ]);
  const attempt = latest.status === 'fulfilled' ? latest.value : null;
  try {
    if (manifest.status === 'rejected') throw manifest.reason;
    assertManifest(manifest.value);
    return {map: manifest.value, attempt, error: ''};
  } catch (error) {
    return {map: null, attempt, error: error instanceof Error ? error.message : String(error)};
  }
}

export default function AppMap({adapter, config}: AtlasViewerProps) {
  const presentation = useMemo<ViewerPresentation>(() => {
    if (adapter) return adapter;
    const {shell, layoutKey, sharedRoles, captureHint, fingerprintUrl, workspaceStatusUrl, preview, managedLive} =
      config;
    return {
      shell,
      layoutKey,
      sharedRoles,
      captureHint,
      ...createManagedLiveAdapter(managedLive),
      previewUrl: createPreviewUrl(preview),
      isolatedPreview: Boolean(preview && 'sessionParam' in preview && preview.sessionParam),
      workspaceFreshness: workspaceStatusUrl
        ? async (accountId, revisionId) => {
            const response = await fetch(workspaceStatusUrl, {cache: 'no-store'});
            if (!response.ok) return null;
            const status = (await response.json()).workspaces?.find((w: {id: string}) => w.id === accountId);
            return status ? status.revisionId !== revisionId || status.configurationChanged : true;
          }
        : undefined,
      sourceFingerprint: fingerprintUrl ? () => readSourceFingerprint(fingerprintUrl) : undefined
    };
  }, [adapter, config]);

  // 配置的外壳重建不是换源；适配器方法还依赖接收者，不能只比较函数引用。
  const artifactSource = config ? JSON.stringify(config.artifactPaths) : undefined;
  const source = useMemo(
    () => ({}),
    [artifactSource, config?.layoutKey, adapter, adapter?.loadManifest, adapter?.layoutKey]
  );
  const [loaded, setLoaded] = useState(() => ({source, snapshot: emptySnapshot}));
  // 在 effect 发出新请求前就隐藏旧图，避免旧节点写入新 layoutKey。
  const {map, attempt, error} = loaded.source === source ? loaded.snapshot : emptySnapshot;
  const revision = useRef(0);
  const load = useCallback(() => {
    const request = ++revision.current;
    setLoaded(previous => ({
      source,
      snapshot: previous.source === source ? {...previous.snapshot, error: ''} : emptySnapshot
    }));
    const pending = adapter ? readAdapterSnapshot(adapter) : readViewerSnapshot(config);
    void pending.then(snapshot => {
      if (request !== revision.current) return;
      setLoaded(previous => {
        const before = previous.source === source ? previous.snapshot : emptySnapshot;
        return {
          source,
          snapshot: snapshot.map
            ? snapshot
            : {
                ...before,
                attempt: snapshot.attempt ?? before.attempt,
                error: snapshot.error || 'Could not load captures'
              }
        };
      });
    });
  }, [adapter, config, source]);
  useEffect(() => {
    load();
    return () => {
      revision.current++;
    };
  }, [load]);

  if (!map)
    return (
      <main className="app-map">
        <ShellHeader presentation={presentation} />
        <AttemptNotice attempt={attempt} hasMap={false} />
        <section className="map-empty" aria-label="Capture results">
          {error ? (
            <>
              <p role="alert">{error}</p>
              <code>{presentation.captureHint ?? 'Run the project’s Atlas capture adapter'}</code>
              <p>
                <button onClick={load}>Reload</button>
              </p>
            </>
          ) : (
            <p role="status">Loading captured screens…</p>
          )}
        </section>
      </main>
    );

  return (
    <AccountCanvas
      key={`${presentation.layoutKey ?? 'atlas'}:${map.applicationId ?? 'legacy'}:${map.profileId ?? 'default'}`}
      map={map}
      attempt={attempt}
      error={error}
      refresh={load}
      presentation={presentation}
    />
  );
}

function AccountCanvas({
  map,
  attempt,
  error,
  refresh,
  presentation
}: {
  map: AppMapManifest;
  attempt: CaptureAttempt | null;
  error: string;
  refresh: () => void;
  presentation: ViewerPresentation;
}) {
  const accounts = useMemo(() => accountWorkspaces(map), [map]);
  const namespace = `${presentation.layoutKey ?? 'atlas'}:${map.applicationId ?? 'legacy'}:${map.profileId ?? 'default'}:accounts-v2`;
  const [selection, setSelection] = useState(() => {
    try {
      return localStorage.getItem(`${namespace}:selected`) ?? '';
    } catch {
      return '';
    }
  });
  const active = accounts.find(a => a.id === selection) ?? accounts.find(a => a.id !== '@anonymous') ?? accounts[0];
  const selectAccount = (id: string) => {
    setSelection(id);
    try {
      localStorage.setItem(`${namespace}:selected`, id);
    } catch {
      /* Storage is optional. */
    }
  };
  const scopedPresentation = useMemo(
    () => ({...presentation, layoutKey: `${namespace}:${active?.id}`}),
    [presentation, namespace, active?.id]
  );
  if (!active)
    return (
      <main className="app-map">
        <p role="status">No account workspaces available.</p>
      </main>
    );
  return (
    <ReactFlowProvider key={`${namespace}:${active.id}`}>
      <MapCanvas
        map={active.map}
        accounts={accounts}
        accountId={active.id}
        selectAccount={selectAccount}
        attempt={attempt?.captureId === active.map.captureId ? null : attempt}
        loadError={error}
        refresh={refresh}
        adapter={scopedPresentation}
      />
    </ReactFlowProvider>
  );
}
