import {mkdir, writeFile, rename, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {stripVTControlCharacters} from 'node:util';

export function validateCatalog({screens, edges}) {
  if (!Array.isArray(screens) || !Array.isArray(edges) || !screens.length) throw Error('目录不能为空');
  const ids = new Set();
  for (const screen of screens) {
    for (const key of ['id', 'role', 'entry', 'route', 'title', 'group', 'state']) {
      if (typeof screen?.[key] !== 'string' || !screen[key].trim()) throw Error(`页面字段无效: ${key}`);
    }
    if (ids.has(screen.id)) throw Error(`页面 ID 重复: ${screen.id}`);
    ids.add(screen.id);
  }
  const edgeIds = new Set();
  for (const edge of edges) {
    if (typeof edge?.id !== 'string' || !edge.id.trim() || edgeIds.has(edge.id) ||
        !ids.has(edge.source) || !ids.has(edge.target) || typeof edge.action !== 'string' || !edge.action.trim()) {
      throw Error('连线 ID、端点或操作无效');
    }
    edgeIds.add(edge.id);
  }
}

export function errorMessage(error) {
  return stripVTControlCharacters(error instanceof Error ? error.message : String(error));
}

async function writeAtomic(output, filename, value, captureId) {
  const temporary = resolve(output, `${captureId}.${filename}.next`);
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2));
    await rename(temporary, resolve(output, filename));
  } catch (error) {
    await rm(temporary, {force: true}).catch(() => {});
    throw error;
  }
}

export async function createBatch(output) {
  await mkdir(output, {recursive: true});
  for (let suffix = 0; ; suffix++) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const captureId = suffix ? `${stamp}-${suffix}` : stamp;
    const directory = resolve(output, captureId);
    try {
      await mkdir(directory);
      return {captureId, directory};
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

async function assertState(session, screen) {
  const route = await session.currentRoute();
  if (route !== screen.route) throw Error(`目标不匹配: ${screen.id} 期望路由 ${screen.route}，实际 ${route}`);
  if (!await session.matchesState(screen)) throw Error(`页面状态不匹配: ${screen.id}`);
}

/** 直接传入 browser 时由调用者管理生命周期，传入 launchBrowser 时由本批采集管理。 */
export async function capture({
  adapter, browser, launchBrowser, output, publicPath = '/generated',
  viewport = {width: 393, height: 852}, requireObservedEdges = false,
}) {
  const ownsBrowser = !browser && Boolean(launchBrowser);
  const {captureId, directory} = await createBatch(output);
  const artifact = filename => `${publicPath.replace(/\/$/, '')}/${captureId}/${filename}`;
  let result;
  let failure;
  let stage = 'catalog';

  async function session(screen, work) {
    const current = await adapter.open({browser, screen, viewport});
    try {
      await current.ready(screen);
      await assertState(current, screen);
      await work(current);
    } finally {
      try {
        await current.close();
      } finally {
        result.runtimeErrors.push(...current.errors);
      }
    }
    if (current.errors.length) throw Error(current.errors.join('\n'));
  }

  try {
    if (typeof adapter === 'function') adapter = await adapter();
    const catalog = await adapter.catalog();
    validateCatalog(catalog);
    const byId = new Map(catalog.screens.map(screen => [screen.id, screen]));
    stage = 'source';
    const fingerprint = await adapter.sourceFingerprint?.() ?? '';
    result = {
      theme: '默认主题', scenarioId: 'default', seedVersion: '1', scope: '适配器登记的页面状态与操作',
      ...adapter.metadata, schemaVersion: 1, captureId, capturedAt: new Date().toISOString(),
      sourceFingerprint: fingerprint, viewport, screens: [], edges: [], runtimeErrors: [],
    };
    stage = 'browser';
    if (!browser) {
      if (!launchBrowser) throw Error('未提供采集浏览器');
      browser = await launchBrowser();
    }
    stage = 'capture';
    for (const screen of catalog.screens) {
      const {id, role, entry, route, title, group, state} = screen;
      const node = {id, role, entry, route, title, group, state, status: 'failed'};
      try {
        await session(screen, async current => {
          const file = `${result.screens.length}.png`;
          await current.page.screenshot({path: resolve(directory, file)});
          await assertState(current, screen);
          node.image = artifact(file);
          node.actualRoute = route;
          node.capturedAt = new Date().toISOString();
        });
        node.status = 'captured';
      } catch (error) {
        node.error = errorMessage(error);
        delete node.image;
      }
      result.screens.push(node);
      console.log(`页面 ${node.status}: ${title}`);
    }
    for (const edge of catalog.edges) {
      const {id, source, target, action, sourceFile = ''} = edge;
      const record = {id, source, target, action, sourceFile, status: 'declared'};
      if (adapter.perform && edge.verify !== false) {
        try {
          const from = byId.get(source);
          const to = byId.get(target);
          const sameRoute = from.route === to.route;
          await session(from, async current => {
            if (sameRoute && await current.matchesState(to)) {
              record.reason = '操作前目标状态已成立，无法区分前后状态';
              return;
            }
            await adapter.perform(current, edge);
            await current.ready(to);
            await assertState(current, to);
            if (sameRoute && await current.matchesState(from)) throw Error('操作后源页面状态仍成立');
          });
          if (!record.reason) record.status = 'observed';
        } catch (error) {
          record.status = 'failed';
          record.reason = errorMessage(error);
        }
      }
      result.edges.push(record);
      console.log(`连线 ${record.status}: ${action}`);
    }
    stage = 'source';
    if (fingerprint !== (await adapter.sourceFingerprint?.() ?? '')) {
      throw Error('采集期间源码变化，拒绝发布混合版本');
    }
    stage = 'capture';
    const unverified = requireObservedEdges && result.edges.filter(edge => edge.status === 'declared');
    if (unverified && unverified.length) {
      throw Error(`存在 ${unverified.length} 条未验证连线，拒绝发布：${unverified[0].id}`);
    }
  } catch (error) {
    failure = {stage, error: errorMessage(error), cause: error};
  } finally {
    if (ownsBrowser && browser) {
      try {
        await browser.close();
      } catch (error) {
        failure ??= {stage: 'browser', error: errorMessage(error), cause: error};
      }
    }
  }

  const failedScreens = result?.screens.filter(screen => screen.status === 'failed') ?? [];
  const failedEdges = result?.edges.filter(edge => edge.status === 'failed') ?? [];
  const batchError = failure?.error ?? failedScreens[0]?.error ?? failedEdges[0]?.reason ?? result?.runtimeErrors[0] ?? null;
  const failed = batchError !== null;
  const attempt = {
    captureId, completedAt: new Date().toISOString(), status: failed ? 'failed' : 'passed',
    failedScreens: failedScreens.length, failedEdges: failedEdges.length,
    stage: failure?.stage ?? (failed ? 'capture' : 'complete'), error: batchError,
    report: artifact('attempt.json'),
  };
  await publishBatch({output, directory, captureId, result, attempt});
  if (failed) console.error(`采集失败，未更新当前画布；报告：${resolve(directory, 'attempt.json')}`);
  if (failure) throw failure.cause;
  return result;
}

export async function publishBatch({output, directory, captureId, result, attempt}) {
  try {
    if (result) await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(result, null, 2));
    await writeAtomic(directory, 'attempt.json', attempt, captureId);
    await writeAtomic(output, 'latest-attempt.json', attempt, captureId);
    // 当前地图是最后的发布动作。最近尝试不可写时，旧图仍可读。
    if (attempt.status === 'passed') await writeAtomic(output, 'manifest.json', result, captureId);
  } catch (error) {
    const publicationFailure = {
      ...attempt, status: 'failed', stage: 'publication',
      error: [`发布失败：${errorMessage(error)}`, attempt.error].filter(Boolean).join('\n'),
    };
    try {
      await writeAtomic(directory, 'attempt.json', publicationFailure, captureId);
      console.error(`发布失败，未更新当前画布；报告：${resolve(directory, 'attempt.json')}`);
      await writeAtomic(output, 'latest-attempt.json', publicationFailure, captureId);
    } catch (reportError) {
      console.error(`无法完整更新发布失败报告：${errorMessage(reportError)}`);
    }
    throw error;
  }
}
