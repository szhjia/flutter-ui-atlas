import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AppMap, {type AtlasViewerAdapter} from '../../../packages/viewer/src/AppMap';
import {graph} from './graphs';

let available = false;
const firstMap = {...graph(1), edges: []};
const secondMap = {
  ...firstMap,
  captureId: 'source-b',
  screens: [{...firstMap.screens[0], id: 'b-page', title: '来源 B 页面'}]
};
const first: AtlasViewerAdapter = {title: '来源 A', layoutKey: 'recovery:a', loadManifest: async () => firstMap};
const second: AtlasViewerAdapter = {
  title: '来源 B',
  layoutKey: 'recovery:b',
  loadManifest: async () => {
    if (!available) throw Error('来源 B 暂时不可用');
    return secondMap;
  }
};
function Demo() {
  const [adapter, setAdapter] = useState(first);
  return (
    <>
      <button onClick={() => setAdapter(second)}>切换来源 B</button>
      <button
        onClick={() => {
          available = true;
        }}
      >
        准备来源 B
      </button>
      <AppMap adapter={adapter} />
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
