import type {Browser, Page} from 'playwright';
import type {AppMapManifest, MapScreen, MapEdge} from '../viewer/src/model';

export type ScreenSpec = Pick<MapScreen, 'id' | 'role' | 'entry' | 'route' | 'title' | 'group' | 'state'>;
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
  open(context: {browser: Browser; screen: ScreenSpec; viewport: {width: number; height: number}}): Promise<CaptureSession>;
  perform?(session: CaptureSession, edge: EdgeSpec): Promise<void>;
}
