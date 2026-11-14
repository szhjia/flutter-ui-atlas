import type {AppMapManifest, CaptureAttempt, MapScreen} from './model';
import {assertUniqueRoutes} from '../../capture/route-identity.mjs';

export interface AtlasHeaderLink {
  label: string;
  href: string;
}

export interface AtlasShellConfig {
  title?: string;
  logoUrl?: string;
  logoText?: string;
  /** @deprecated 页眉已改为单行，保留该字段供旧配置使用。 */
  subtitle?: string;
  headerLinks?: readonly AtlasHeaderLink[];
  introNote?: string;
}

export interface AtlasPreviewConfig {
  origin: string;
  sessionParam?: string;
  entries?: Readonly<Record<string, {path: string; hashRoute?: boolean}>>;
  query?: Readonly<Record<string, string>>;
}

export interface AtlasViewerConfig {
  shell?: AtlasShellConfig;
  layoutKey?: string;
  sharedRoles?: readonly string[];
  captureHint?: string;
  artifactPaths: readonly string[];
  fingerprintUrl?: string;
  workspaceStatusUrl?: string;
  managedLive?: {endpoint: string; token: string};
  preview?:
    | AtlasPreviewConfig
    | {urls: Readonly<Record<string, string>>}
    | {routeMode: 'hash' | 'pathname'; localOnly?: boolean};
}

function httpUrl(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function rootedPath(value: string) {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');
}

export function safeLink(href: string): boolean {
  return rootedPath(href)
    ? httpUrl(href, 'https://atlas.invalid')?.origin === 'https://atlas.invalid'
    : /^https?:\/\//i.test(href) && httpUrl(href) !== null;
}

export function createPreviewUrl(preview: AtlasViewerConfig['preview']) {
  if (!preview) return undefined;
  return (screen: MapScreen, sessionId: string): string | null => {
    if ('urls' in preview) {
      return Object.hasOwn(preview.urls, screen.id) ? (httpUrl(preview.urls[screen.id])?.href ?? null) : null;
    }
    if ('routeMode' in preview) {
      const url = httpUrl(screen.entry);
      if (!url || (preview.localOnly && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return null;
      if (preview.routeMode === 'hash' && (preview.localOnly || !url.hash)) url.hash = screen.route;
      return url.href;
    }

    const origin = httpUrl(preview.origin)?.origin;
    if (!origin) return null;
    const entry =
      preview.entries && Object.hasOwn(preview.entries, screen.entry) ? preview.entries[screen.entry] : undefined;
    if (preview.entries && !entry) return null;
    const path = screen.previewPath ?? entry?.path;
    if (!path || !rootedPath(path)) return null;
    const url = httpUrl(path, origin);
    if (!url || url.origin !== origin || (entry && url.pathname !== entry.path)) return null;
    if (!screen.previewPath && entry?.hashRoute) url.hash = '/' + screen.route.replace(/^\//, '');
    for (const [name, value] of Object.entries(preview.query ?? {})) url.searchParams.set(name, value);
    if (preview.sessionParam) url.searchParams.set(preview.sessionParam, sessionId);
    return url.href;
  };
}

export interface AtlasLiveSessionInput {
  screenId: string;
  captureId: string;
  requestId: string;
  signal: AbortSignal;
}
export interface AtlasLiveSessionHandle {
  id: string;
  requestId: string;
  screenId: string;
  captureId: string;
  state: 'ready';
}
export interface AtlasLiveSessionStatus {
  state: 'idle' | 'opening' | 'ready' | 'failed';
  id?: string;
  requestId?: string;
  error?: string;
}
export function createManagedLiveAdapter(config: AtlasViewerConfig['managedLive']) {
  if (!config) return undefined;
  if (!rootedPath(config.endpoint) || /[?#]/.test(config.endpoint) || !config.token)
    throw Error('Live sessions require a same-origin endpoint and a session token.');
  const endpoint = config.endpoint.replace(/\/$/, '');
  async function call(path: string, body?: object, signal?: AbortSignal) {
    const response = await fetch(`${endpoint}/${path}`, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {'x-atlas-token': config!.token, ...(body ? {'content-type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined,
      signal,
      keepalive: path === 'close'
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.message || `Live session request failed (HTTP ${response.status})`);
    return result;
  }
  return {
    async openLiveSession({
      screenId,
      captureId,
      requestId,
      signal
    }: AtlasLiveSessionInput): Promise<AtlasLiveSessionHandle> {
      return call('open', {screenId, captureId, requestId}, signal);
    },
    async closeLiveSession(id: string): Promise<void> {
      await call('close', {id});
    },
    async liveSessionStatus(): Promise<AtlasLiveSessionStatus> {
      return call('status');
    }
  };
}

export interface ViewerSnapshot {
  map: AppMapManifest | null;
  attempt: CaptureAttempt | null;
  error: string;
}

export const emptySnapshot: ViewerSnapshot = {map: null, attempt: null, error: ''};
export const missingManifest = 'No captures yet. Run the capture command first.';

export function assertManifest(value: unknown): asserts value is AppMapManifest {
  const map = value as Partial<AppMapManifest> | null;
  if (
    !map ||
    ![1, 2].includes(map.schemaVersion ?? 0) ||
    !Array.isArray(map.screens) ||
    !Array.isArray(map.edges) ||
    !map.viewport ||
    !Number.isFinite(map.viewport.width) ||
    !Number.isFinite(map.viewport.height) ||
    map.screens.some(
      screen => typeof screen?.id !== 'string' || !['captured', 'pending', 'failed'].includes(screen.status)
    ) ||
    map.edges.some(
      edge =>
        typeof edge?.id !== 'string' ||
        typeof edge.source !== 'string' ||
        typeof edge.target !== 'string' ||
        !['declared', 'observed', 'failed'].includes(edge.status)
    )
  ) {
    throw Error('Invalid capture manifest');
  }
  assertUniqueRoutes(map.screens!);
  if (map.workspaces) {
    if (!Array.isArray(map.workspaces) || !map.workspaces.length) throw Error('Invalid workspaces');
    for (const workspace of map.workspaces) {
      if (typeof workspace.id !== 'string' || typeof workspace.name !== 'string' || workspace.map.workspaces)
        throw Error('Invalid workspace');
      assertManifest(workspace.map);
    }
  }
}

async function readAttempt(base: string): Promise<CaptureAttempt | null> {
  try {
    const response = await fetch(`${base}/latest-attempt.json`, {cache: 'no-store'});
    if (!response.ok) return null;
    const attempt = (await response.json()) as CaptureAttempt | null;
    if (
      !attempt ||
      !['passed', 'failed'].includes(attempt.status) ||
      (attempt.error != null && typeof attempt.error !== 'string')
    )
      return null;
    return attempt;
  } catch {
    return null;
  }
}

export async function readViewerSnapshot(config: AtlasViewerConfig): Promise<ViewerSnapshot> {
  let firstSource: string | undefined;
  for (const path of config.artifactPaths) {
    const base = path.replace(/\/$/, '');
    if (!rootedPath(base) || /[?#]/.test(base)) {
      return {...emptySnapshot, error: 'Capture directories must use same-origin paths.'};
    }
    firstSource ??= base;
    try {
      const response = await fetch(`${base}/manifest.json`, {cache: 'no-store'});
      // Vite 的静态预览会用 HTML 回退尚不存在的文件。
      if (response.status === 404 || (response.ok && response.headers.get('content-type')?.includes('text/html')))
        continue;
      if (!response.ok) throw Error(`Could not load captures (HTTP ${response.status})`);
      const map: unknown = await response.json().catch(() => {
        throw Error('Invalid capture manifest');
      });
      assertManifest(map);
      return {map, attempt: await readAttempt(base), error: ''};
    } catch (error) {
      return {
        map: null,
        attempt: await readAttempt(base),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  return {...emptySnapshot, error: missingManifest, attempt: firstSource ? await readAttempt(firstSource) : null};
}

export async function readSourceFingerprint(url: string): Promise<string | null> {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) return null;
  const {fingerprint} = await response.json();
  return typeof fingerprint === 'string' ? fingerprint : null;
}
