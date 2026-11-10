import {createRoot} from 'react-dom/client';
import AppMap, {type AtlasViewerAdapter} from '../packages/viewer/src/AppMap';

declare const __ATLAS_CONFIG__: {
  publicPath: string;
  previewUrls: Record<string, string>;
  layoutKey: string;
  title?: string;
  hasSourceFingerprint: boolean;
  previewRouteMode?: 'hash' | 'pathname';
} | undefined;

const config = typeof __ATLAS_CONFIG__ === 'undefined' ? undefined : __ATLAS_CONFIG__;
const publicPath = config?.publicPath ?? '/generated';
const adapter: AtlasViewerAdapter = {
  title: config?.title ?? 'Flutter UI Atlas',
  layoutKey: config?.layoutKey ?? 'atlas-example:phone-393x852:v1',
  captureHint: 'rtk proxy pnpm atlas capture --config <配置文件>',
  async loadManifest() {
    const response = await fetch(`${publicPath}/manifest.json`, {cache: 'no-store'});
    if (!response.ok) throw Error('尚无可用采集结果，请先运行采集命令。');
    return response.json();
  },
  async loadLatestAttempt() {
    const response = await fetch(`${publicPath}/latest-attempt.json`, {cache: 'no-store'});
    return response.ok ? response.json() : null;
  },
  ...(config?.hasSourceFingerprint && {
    async sourceFingerprint() {
      const response = await fetch('/__atlas/source', {cache: 'no-store'});
      return response.ok ? (await response.json()).fingerprint ?? null : null;
    },
  }),
  ...(!config ? {
    previewUrl: screen => {
      const url = new URL(screen.entry);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') {
        throw Error('示例只接受本机 HTTP 入口');
      }
      url.hash = screen.route;
      return url.href;
    },
  } : config.previewRouteMode ? {
    previewUrl: screen => {
      try {
        const url = new URL(screen.entry);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        if (config.previewRouteMode === 'hash' && !url.hash) url.hash = screen.route;
        return url.href;
      } catch {
        return null;
      }
    },
  } : Object.keys(config.previewUrls).length ? {
    previewUrl: screen => Object.hasOwn(config.previewUrls, screen.id) ? config.previewUrls[screen.id] : null,
  } : {}),
};
createRoot(document.getElementById('root')!).render(<AppMap adapter={adapter}/>);
