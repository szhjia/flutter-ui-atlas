import {createRoot} from 'react-dom/client';
import AppMap, {type AtlasViewerAdapter} from '../../../packages/viewer/src/AppMap';
import {graph} from './graphs';
const params = new URLSearchParams(location.search),
  count = params.has('dense') ? 100 : 8,
  key = `fixture:${params.get('key') ?? count}`,
  storage = `flutter-ui-atlas:layout:v1:${key}:legacy:default:accounts-v2:legacy:示例`;
let map = graph(count);
if (!localStorage.getItem(storage))
  localStorage.setItem(
    storage,
    JSON.stringify({
      schemaVersion: 1,
      nodes: Object.fromEntries(
        map.screens.map((s, i) => [
          s.id,
          {
            x: count === 100 ? (i % 10) * 440 : i === 0 ? 0 : i === 1 ? 500 : 3000 + (i - 2) * 450,
            y: count === 100 ? Math.floor(i / 10) * 680 : 0,
            locked: i === 2
          }
        ])
      ),
      viewport: {x: 40, y: 35, zoom: Number(params.get('zoom') ?? 0.65)}
    })
  );
const adapter: AtlasViewerAdapter = {
  layoutKey: key,
  title: '画布验收',
  loadManifest: async () => map,
  previewUrl: () => '/tests/browser/fixtures/live.html'
};
function Demo() {
  return (
    <>
      <div className="fixture-tools">
        <button
          onClick={() => {
            map = {...map, captureId: 'fixture-2', screens: map.screens.filter(s => s.id !== 'n0')};
          }}
        >
          准备删除页面采集
        </button>
      </div>
      <AppMap adapter={adapter} />
    </>
  );
}
// 仅验收页观测原生鼠标事件到下一次绘制，不进入工具包。
const samples: number[] = [];
(window as any).canvasFeedback = samples;
window.addEventListener(
  'pointermove',
  e => {
    if (e.buttons === 1) {
      const start = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => samples.push(performance.now() - start)));
    }
  },
  true
);
createRoot(document.getElementById('root')!).render(<Demo />);
