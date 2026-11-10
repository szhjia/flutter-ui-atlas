import {createRoot} from 'react-dom/client';
import AppMap, {type AtlasViewerConfig} from '../packages/viewer/src/AppMap';

declare const __ATLAS_CONFIG__: AtlasViewerConfig | undefined;

const config: AtlasViewerConfig = typeof __ATLAS_CONFIG__ !== 'undefined' ? __ATLAS_CONFIG__ : {
  artifactPaths: ['/generated'],
  shell: {title: 'Flutter UI Atlas'},
  layoutKey: 'atlas-example:phone-393x852:v1',
  captureHint: 'rtk proxy pnpm atlas capture --config <配置文件>',
  preview: {routeMode: 'hash', localOnly: true},
};

createRoot(document.getElementById('root')!).render(<AppMap config={config}/>);
