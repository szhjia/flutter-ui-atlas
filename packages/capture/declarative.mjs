import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assertLoopback} from './web-boundary.mjs';

export function webUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw Error('Web 地址必须是无凭据的 HTTP(S) URL');
  }
  return url;
}

function locator(page, spec) {
  if (spec.role) return page.getByRole(spec.role, {name: spec.name, exact: true});
  return page.getByText(spec.text, {exact: true});
}

function checkLocator(spec, label, roleOnly = false) {
  if (typeof spec?.role === 'string' && spec.role && typeof spec.name === 'string' && spec.name) return;
  if (!roleOnly && typeof spec?.text === 'string' && spec.text) return;
  throw Error(`${label} 必须指定 role/name${roleOnly ? '' : ' 或 text'}`);
}

export function sourceFingerprintForFiles(files, directory) {
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !file)) {
    throw Error('sourceFiles 必须是文件路径数组');
  }
  if (!files.length) return undefined;
  return async () => {
    const hash = createHash('sha256');
    for (const file of files) hash.update(file).update('\0').update(await readFile(resolve(directory, file))).update('\0');
    return hash.digest('hex');
  };
}

export function declarativeConfig(config, configDirectory) {
  if (typeof config.baseUrl !== 'string' || !Array.isArray(config.screens)) {
    throw Error('配置需要 baseUrl 和 screens');
  }
  if (config.allowRemoteUrls !== undefined && typeof config.allowRemoteUrls !== 'boolean') {
    throw Error('allowRemoteUrls 必须是布尔值');
  }
  const base = webUrl(config.baseUrl);
  assertLoopback(base, {
    allowRemote: config.allowRemoteUrls === true,
    message: 'baseUrl 必须是本地回环地址；如需采集局域网或远程开发服务，在配置中设置 allowRemoteUrls: true。',
  });
  const mode = config.routeMode ?? 'hash';
  if (mode !== 'hash' && mode !== 'pathname') throw Error('routeMode 必须是 hash 或 pathname');
  let routePrefix = '';
  if (config.routePrefix !== undefined) {
    // URL 规范化会解码 %2e 等形态并折叠点段，点段检查须在解码后的值上进行。
    let decodedPrefix = config.routePrefix;
    if (typeof config.routePrefix === 'string') {
      try { decodedPrefix = decodeURIComponent(config.routePrefix); }
      catch { throw Error('routePrefix 包含无效的 URL 编码'); }
    }
    if (typeof config.routePrefix !== 'string' || !/^\/(?!\/)[^?#]*$/.test(config.routePrefix) ||
        config.routePrefix.endsWith('/') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodedPrefix) ||
        /[\\\u0000-\u001f\u007f]/.test(decodedPrefix)) {
      throw Error('routePrefix 必须是以 / 开头且不以 / 结尾、不含点段、反斜杠与控制字符的路径前缀');
    }
    routePrefix = config.routePrefix;
  }
  function routeOf(url) {
    return mode === 'hash' ? url.hash.slice(1).split('?')[0] || '/' : url.pathname;
  }
  function matchesLocation(url, target) {
    return url.origin === base.origin && routeOf(url) === target.route &&
      (mode !== 'hash' || url.pathname === new URL(target.entry).pathname);
  }
  const screens = config.screens.map(spec => {
    checkLocator(spec.ready, `页面 ${spec.id} 的 ready`);
    if (typeof spec.route !== 'string' || !/^\/(?!\/)[^?#]*$/.test(spec.route)) {
      throw Error(`页面 ${spec.id} 的 route 必须是 / 开头的路由`);
    }
    const url = webUrl(spec.entry ?? base.href, base);
    if (url.origin !== base.origin) throw Error(`页面 ${spec.id} 的入口必须与 baseUrl 同源`);
    if (mode === 'hash') url.hash = spec.route;
    else {
      url.pathname = routePrefix + spec.route;
      const prefixPath = new URL(base);
      prefixPath.pathname = routePrefix + '/';
      if (routePrefix && !url.pathname.startsWith(prefixPath.pathname)) {
        throw Error(`页面 ${spec.id} 的 route 规范化后离开 routePrefix 目录`);
      }
    }
    return {
      ...spec, route: routeOf(url), entry: url.href,
      role: spec.role ?? '默认', group: spec.group ?? '页面', state: spec.state ?? '默认状态',
    };
  });
  const edges = (config.edges ?? []).map(edge => {
    if (edge.click !== undefined) checkLocator(edge.click, `连线 ${edge.id} 的 click`, true);
    return edge.click === undefined ? {...edge, verify: false} : edge;
  });
  const sourceFingerprint = sourceFingerprintForFiles(config.sourceFiles ?? [], configDirectory);
  const timeout = config.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw Error('timeoutMs 必须是正整数');
  return {
    previewUrls: Object.fromEntries(screens.map(screen => [screen.id, screen.entry])),
    adapter: {
      catalog: async () => ({screens, edges}),
      sourceFingerprint,
      async open({browser, screen, viewport}) {
        const context = await browser.newContext({viewport});
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(timeout);
          const errors = [];
          page.on('pageerror', error => errors.push(String(error)));
          page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
          });
          await page.goto(screen.entry, {waitUntil: 'domcontentloaded'});
          return {
            page, errors, close: () => context.close(),
            currentRoute: async () => {
              const url = new URL(page.url());
              return url.origin === base.origin ? routeOf(url) : url.href;
            },
            async matchesState(target) {
              const content = locator(page, target.ready).filter({visible: true}).first();
              return matchesLocation(new URL(page.url()), target) && await content.isVisible() &&
                matchesLocation(new URL(page.url()), target);
            },
            async ready(target) {
              const deadline = Date.now() + timeout;
              const remaining = () => Math.max(1, deadline - Date.now());
              const content = locator(page, target.ready).filter({visible: true}).first();
              const enable = page.locator('flt-semantics-placeholder')
                .and(page.getByRole('button', {name: 'Enable accessibility', exact: true}));
              await content.or(enable).filter({visible: true}).first().waitFor({state: 'visible', timeout});
              if (!await content.isVisible() && await enable.isVisible()) {
                // Flutter 的无障碍入口在视口外，辅助技术通过 click 事件激活。
                await enable.dispatchEvent('click', {}, {timeout: remaining()});
              }
              try {
                await page.waitForURL(url => matchesLocation(url, target), {timeout: remaining(), waitUntil: 'domcontentloaded'});
              } catch (error) {
                if (error.name !== 'TimeoutError') throw error;
                throw Error(`目标入口或路由未到位：${target.id}，期望 ${target.entry}，实际 ${page.url()}`, {cause: error});
              }
              await content.waitFor({state: 'visible', timeout: remaining()});
            },
          };
        } catch (error) {
          await context.close();
          throw error;
        }
      },
      perform: (session, edge) => locator(session.page, edge.click).click(),
    },
  };
}
