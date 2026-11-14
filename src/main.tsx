import {createRoot} from 'react-dom/client';
import AppMap from '../packages/viewer/src/AppMap';
import {parseEntryConfig} from './entry-config';

const {config, error} = parseEntryConfig(document.getElementById('atlas-config')?.textContent);
const root = document.getElementById('root')!;

// 失败不降级：配置解析失败从未有过好状态，进入错误态但给出可行动诊断，不白屏。
if (error || !config) {
  createRoot(root).render(
    <main className="app-map">
      <section className="map-empty" aria-label="Canvas configuration">
        <p role="alert">{error}</p>
        <p>
          <button onClick={() => location.reload()}>Reload</button>
        </p>
      </section>
    </main>
  );
} else {
  createRoot(root).render(<AppMap config={config} />);
}
