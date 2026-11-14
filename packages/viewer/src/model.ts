export interface MapScreen {
  accountId?: string;
  pageName?: string;
  id: string;
  role: string;
  entry: string;
  route: string;
  title: string;
  group: string;
  state: string;
  status: 'captured' | 'pending' | 'failed';
  image?: string;
  error?: string;
  capturedAt?: string;
  actualRoute?: string;
  discoverySource?: string;
  previewPath?: string;
}
export interface MapEdge {
  id: string;
  source: string;
  target: string;
  action: string;
  sourceFile: string;
  status: 'observed' | 'declared' | 'failed';
  reason?: string;
  recordingSources?: ('manual' | 'test')[];
}
export interface AppMapManifest {
  reused?: boolean;
  configurationChanged?: boolean;
  applicationId?: string;
  profileId?: string;
  generationId?: string;
  revisionId?: string;
  accountId?: string;
  workspaces?: {id: string; name: string; map: AppMapManifest}[];
  schemaVersion: number;
  captureId: string;
  capturedAt: string;
  sourceFingerprint: string;
  viewport: {width: number; height: number};
  theme: string;
  scenarioId: string;
  seedVersion: string;
  scope: string;
  screens: MapScreen[];
  edges: MapEdge[];
  runtimeErrors?: string[];
  discovery?: boolean;
  diagnostics?: string[];
}
export interface CaptureAttempt {
  captureId: string;
  completedAt: string;
  status: 'passed' | 'failed';
  failedScreens: number;
  failedEdges: number;
  stage?: string;
  error: string | null;
  report: string;
}
export function visibleScreens(
  map: AppMapManifest,
  role: string,
  group: string,
  query: string,
  sharedRoles: readonly string[] = []
) {
  const search = query.trim().toLowerCase();
  return map.screens.filter(
    screen =>
      (role === '全部' || screen.role === role || sharedRoles.includes(screen.role)) &&
      (group === '全部' || screen.group === group) &&
      (!search || `${screen.pageName ?? screen.title} ${screen.route} ${screen.state}`.toLowerCase().includes(search))
  );
}
export function visibleEdges(edges: MapEdge[], screens: MapScreen[]) {
  const ids = new Set(screens.map(s => s.id));
  return edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
}
