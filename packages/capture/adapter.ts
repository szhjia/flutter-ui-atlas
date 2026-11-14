import type {Browser, Page} from 'playwright';
import type {AppMapManifest, MapScreen, MapEdge} from '../viewer/src/model';

export type ScreenSpec = Pick<MapScreen, 'id' | 'accountId' | 'role' | 'entry' | 'route' | 'title' | 'group' | 'state'>;
export type EdgeSpec = Pick<MapEdge, 'id' | 'source' | 'target' | 'action'> & {sourceFile?: string; verify?: false};

export interface CaptureSession {
  page: Page;
  errors: string[];
  ready(screen: ScreenSpec): Promise<void>;
  currentRoute(): Promise<string>;
  /** 读取实际状态，无论当前是否处于该页面。不能用登记的 ID 或上一次就绪结果作答。 */
  matchesState(screen: ScreenSpec): Promise<boolean>;
  close(): Promise<void>;
}
export interface BrowserAdapter {
  catalog(): Promise<{screens: ScreenSpec[]; edges: EdgeSpec[]}>;
  sourceFingerprint?(): Promise<string>;
  metadata?: Partial<Pick<AppMapManifest, 'theme' | 'scope' | 'scenarioId' | 'seedVersion'>>;
  open(context: {
    browser: Browser;
    screen: ScreenSpec;
    viewport: {width: number; height: number};
  }): Promise<CaptureSession>;
  perform?(session: CaptureSession, edge: EdgeSpec): Promise<void>;
}

export type DiscoveredScreen = ScreenSpec & {discoverySource?: string; previewPath?: string};
export interface DiscoverySession {
  page: Page;
  errors?: string[];
  acceptsUrl(url: string): boolean;
  observe(): Promise<DiscoveredScreen | null>;
  close(): Promise<void>;
}
export interface DiscoveryObserver {
  refresh(): Promise<void>;
  step(action: string, perform: () => Promise<void>): Promise<void>;
}
export interface DiscoveryAdapter {
  metadata?: BrowserAdapter['metadata'];
  sourceFingerprint?(): Promise<string>;
  candidates(): Promise<(DiscoveredScreen & {direct?: boolean})[]>;
  open(context: {
    browser: Browser;
    viewport: {width: number; height: number};
    candidate?: DiscoveredScreen;
  }): Promise<DiscoverySession>;
  journeys?(context: {
    browser: Browser;
    viewport: {width: number; height: number};
    watch(session: DiscoverySession): Promise<DiscoveryObserver>;
  }): Promise<void>;
  preview?: {origin: string; sessionParam?: string};
}
