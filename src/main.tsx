import {createRoot} from 'react-dom/client';
import AppMap, {type AtlasViewerConfig} from '../packages/viewer/src/AppMap';

const configuration = document.getElementById('atlas-config')?.textContent;
const config: AtlasViewerConfig = configuration ? JSON.parse(configuration) : {
  artifactPaths: ['/generated'],
  shell: {title: 'Flutter UI Atlas'},
  layoutKey: 'atlas-example:phone-393x852:v1',
  captureHint: 'atlas build --config <配置文件>',
  preview: {routeMode: 'hash', localOnly: true},
};

createRoot(document.getElementById('root')!).render(<AppMap config={config}/>);
