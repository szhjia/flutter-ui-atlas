import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, rmdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {createBatch, errorMessage, publishBatch, validateCatalog} from './index.mjs';

const sameViewport = (a, b) => a?.width === b.width && a?.height === b.height;
const delay = ms => new Promise(done => setTimeout(done, ms));

async function stableScreen(session, {timeout = 3500, differentFrom, quiet = 300} = {}) {
  const deadline = Date.now() + timeout;
  let key;
  let since;
  do {
    const screen = await session.observe();
    const next = screen && screen.id !== differentFrom ? JSON.stringify(screen) : undefined;
    if (next && next === key && Date.now() - since >= quiet) return screen;
    if (next !== key) {
      key = next;
      since = Date.now();
    }
    await delay(100);
  } while (Date.now() < deadline);
  return null;
}

// 只记录真实点击和键盘激活。普通文本、表单值和无语义的坐标不进入证据。
function installActivationListener() {
  const roles = '[role="button"],[role="link"],[role="tab"],button,a[href]';
  const label = element => {
    const refs = element.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
    const referenced = refs.map(id => element.getRootNode().getElementById(id)?.textContent).filter(Boolean).join(' ');
    // Flutter 的 flt-semantics 按钮也可能直接用文本节点提供名称。
    return (referenced || element.getAttribute('aria-label') || element.textContent).replace(/\s+/g, ' ').trim();
  };
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const target = event.composedPath().find(node => node instanceof Element && node.matches(roles));
    let name = target && label(target);
    if (!name && event.detail > 0) {
      const names = new Set();
      for (const element of document.querySelectorAll(roles)) {
        if (element.matches(':disabled,[aria-disabled="true"]') || element.closest('[aria-hidden="true"],[inert]')) continue;
        const rect = element.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX < rect.right &&
            event.clientY >= rect.top && event.clientY < rect.bottom && label(element)) names.add(label(element));
      }
      if (names.size === 1) name = [...names][0];
    }
    // 密码、文本输入框和应用页面之外的交互不进入动作记录。
    window.__atlasActivation(typeof name === 'string' ? name.trim().slice(0, 120) : '', location.href);
  }, true);
}

async function waitForEnter() {
  const terminal = createInterface({input: process.stdin, output: process.stdout});
  const cancelled = new AbortController();
  terminal.once('SIGINT', () => cancelled.abort());
  try {
    await terminal.question('在浏览器中操作演示页面，按回车结束录制。\n', {signal: cancelled.signal});
  } finally {
    terminal.close();
  }
}

async function manualJourney(session, watch, waitForStop) {
  const observer = await watch(session);
  let recording = false;
  let refreshing = false;
  let stopping = false;
  let task = Promise.resolve();
  let failure;
  let revision = 0;
  const track = (operation, active) => {
    task = Promise.all([task, operation.catch(error => { failure = error; })]).then(() => {
      if (active === revision) recording = false;
    });
  };
  await session.page.exposeBinding('__atlasActivation', ({frame}, action, url) => {
    if (frame !== session.page.mainFrame() || stopping || failure || !session.acceptsUrl(url)) return;
    const overlap = recording;
    const active = ++revision;
    recording = true;
    track(observer.afterActivation(overlap ? '' : action, url, () => active === revision), active);
  });
  await session.page.context().addInitScript(installActivationListener);
  await session.page.evaluate(installActivationListener);
  const timer = setInterval(() => {
    if (recording || refreshing || stopping || failure) return;
    refreshing = true;
    const active = revision;
    track(observer.refresh(() => active === revision).finally(() => { refreshing = false; }), active);
  }, 500);
  try {
    await waitForStop(session);
    stopping = true;
    await task;
    if (failure) throw failure;
  } finally {
    clearInterval(timer);
  }
}

export async function runDiscovery({discovery, launchBrowser, output, publicPath, viewport, mode, waitForStop = waitForEnter}) {
  await mkdir(output, {recursive: true});
  const lock = resolve(output, '.atlas-discovery-lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST') throw Error('自动图谱已有写入任务，请等待该任务结束');
    throw error;
  }
  try {
    return await runBatch({discovery, launchBrowser, output, publicPath, viewport, mode, waitForStop});
  } finally {
    await rmdir(lock);
  }
}

async function runBatch({discovery, launchBrowser, output, publicPath, viewport, mode, waitForStop}) {
  const {captureId, directory} = await createBatch(output);
  const artifact = name => `${publicPath}/${captureId}/${name}`;
  let browser;
  let result;
  let failure;
  try {
    const {sourceFingerprint, candidates, open, journeys} = discovery;
    const metadata = {theme: '默认主题', scenarioId: 'default', seedVersion: '1',
      scope: '路由候选与已观察的浏览器流程', ...discovery.metadata};
    const fingerprint = await sourceFingerprint?.() ?? '';
    const declared = await candidates();
    if (!Array.isArray(declared)) throw Error('路由候选必须是数组');
    if (mode === 'capture' || declared.length) validateCatalog({screens: declared, edges: []});
    const previous = await readFile(resolve(output, 'manifest.json'), 'utf8').then(JSON.parse, error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    const compatible = Boolean(fingerprint && previous?.discovery && previous.sourceFingerprint === fingerprint &&
      sameViewport(previous.viewport, viewport) && previous.scenarioId === metadata?.scenarioId &&
      previous.seedVersion === metadata?.seedVersion && previous.theme === metadata?.theme);
    const nodes = new Map(compatible ? previous.screens.map(screen => [screen.id, screen]) : []);
    const edges = new Map(compatible ? previous.edges.map(edge => [edge.id, edge]) : []);
    const diagnostics = [];
    for (const {direct, ...screen} of declared) {
      if (!nodes.has(screen.id)) nodes.set(screen.id, {...screen, status: 'pending', error: '等待真实页面就绪'});
    }
    result = {
      ...metadata,
      schemaVersion: 1, discovery: true, captureId, capturedAt: new Date().toISOString(),
      sourceFingerprint: fingerprint, viewport, screens: [], edges: [], runtimeErrors: [], diagnostics,
    };
    let imageNumber = 0;
    const note = message => { if (diagnostics.length < 200) diagnostics.push(message); };
    async function save(session, screen, replace = false) {
      if (!screen || (!replace && nodes.get(screen.id)?.status === 'captured')) return Boolean(screen);
      validateCatalog({screens: [screen], edges: []});
      const name = `${imageNumber++}.png`;
      const file = resolve(directory, name);
      await session.page.screenshot({path: file});
      if ((await session.observe())?.id !== screen.id) {
        await rm(file, {force: true});
        return false;
      }
      const {error, status, ...fields} = {...nodes.get(screen.id), ...screen};
      nodes.set(screen.id, {...fields, status: 'captured', actualRoute: screen.route,
        image: artifact(name), capturedAt: new Date().toISOString()});
      return true;
    }
    async function watch(session) {
      let current = await stableScreen(session);
      if (current && !await save(session, current)) current = null;
      let currentUrl = session.page.url();
      const refresh = async (active = () => true) => {
        if (session.page.isClosed()) return;
        const next = await session.observe();
        if (!active() || next?.id === current?.id && session.page.url() === currentUrl) return;
        const screen = await stableScreen(session);
        if (!active()) return;
        current = screen && await save(session, screen) ? screen : null;
        currentUrl = session.page.url();
      };
      const transition = async (source, action, origin, active = () => true) => {
        if (!source || session.page.isClosed()) return;
        const target = await stableScreen(session, {differentFrom: source.id, quiet: 450, timeout: 2500});
        if (!active()) return;
        if (!target || !await save(session, target)) {
          note('操作后没有可确认的新页面');
          return;
        }
        if (!active()) return;
        current = target;
        currentUrl = session.page.url();
        if (!action) {
          note('已观察到页面变化，触发动作未知');
          return;
        }
        const id = 'recorded:' + createHash('sha256').update(JSON.stringify([source.id, target.id, action])).digest('hex').slice(0, 24);
        const sources = [...new Set([...(edges.get(id)?.recordingSources ?? []), origin])].sort();
        edges.set(id, {id, source: source.id, target: target.id, action, sourceFile: '', status: 'observed', recordingSources: sources});
      };
      return {
        refresh,
        afterActivation: (action, url, active) => currentUrl === url
          ? transition(current, action, 'manual', active) : refresh(active),
        async step(action, perform) {
          const source = await session.observe();
          const confirmed = source && await save(session, source) ? source : null;
          await perform();
          await transition(confirmed, action, 'test');
        },
      };
    }
    browser = await launchBrowser();
    if (mode === 'capture') {
      for (const {direct, ...candidate} of declared) {
        if (!direct) continue;
        const session = await open({browser, viewport, candidate});
        try {
          const screen = await stableScreen(session, {timeout: 1600});
          if (screen?.id !== candidate.id || !await save(session, screen, true)) {
            nodes.set(candidate.id, {...candidate, status: 'pending', error: '实际入口、路由、身份或内容与候选不符'});
          }
        } finally {
          await session.close();
        }
        if (session.errors?.length) result.runtimeErrors.push(...session.errors);
      }
    } else if (mode === 'journeys') {
      if (typeof journeys !== 'function') throw Error('当前配置未提供测试录制场景');
      await journeys({browser, viewport, watch});
    } else {
      const session = await open({browser, viewport});
      try {
        await manualJourney(session, watch, waitForStop);
      } finally {
        await session.close();
      }
      if (session.errors?.length) result.runtimeErrors.push(...session.errors);
    }
    if (result.runtimeErrors.length) throw Error('浏览器运行异常，未发布本批图谱');
    if (fingerprint !== (await sourceFingerprint?.() ?? '')) throw Error('采集期间源码变化，拒绝发布混合版本');
    result.screens = [...nodes.values()];
    result.edges = [...edges.values()].filter(edge =>
      nodes.get(edge.source)?.status === 'captured' && nodes.get(edge.target)?.status === 'captured');
    validateCatalog(result);
  } catch (error) {
    failure = error;
  } finally {
    await browser?.close().catch(error => { failure ??= error; });
  }
  const attempt = {
    captureId, completedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed',
    failedScreens: 0, failedEdges: 0, stage: failure ? mode : 'complete',
    error: failure ? errorMessage(failure) : null, report: artifact('attempt.json'),
  };
  await publishBatch({output, directory, captureId, result, attempt});
  if (failure) throw failure;
  return result;
}
