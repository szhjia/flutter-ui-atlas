import {enableFlutterSemantics} from './flutter-semantics.mjs';
import {webUrl} from '../capture/declarative.mjs';

export function locator(page, spec) {
  if (!spec || typeof spec !== 'object') throw Error('定位器必须指定 label、role 或 text');
  if (spec.any) {
    if (!Array.isArray(spec.any) || !spec.any.length) throw Error('定位器 any 必须是非空数组');
    return spec.any.map(item => locator(page, item)).reduce((combined, target) => combined.or(target));
  }
  if (spec.kind === 'label' || spec.label) return page.getByLabel(spec.name ?? spec.label, {exact: true});
  if (spec.kind === 'role' || spec.role) return page.getByRole(spec.role, {name: spec.name, exact: true});
  if (typeof (spec.text ?? spec.name) !== 'string') throw Error('文字定位器缺少 name 或 text');
  return page.getByText(spec.text ?? spec.name, {exact: true});
}
export async function unique(page, spec, options) {
  const target = locator(page, spec).filter({visible: true});
  await waitReady(page, spec, options);
  if ((await target.count()) !== 1) throw Error('操作目标不唯一，请修正定位器');
  return target;
}
export async function fillField(page, spec, value, options) {
  const target = await unique(page, spec, options);
  const flutter = await target.evaluate(element => element.closest('flt-semantics') !== null);
  const rendered = () =>
    page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
  if (flutter) {
    await target.focus();
    await rendered();
  }
  await target.fill(value);
  if (flutter) await rendered();
  return target;
}
export async function matchesReady(page, condition, {baseUrl, routeMode = 'hash', entry} = {}) {
  const url = new URL(page.url());
  if (baseUrl && url.origin !== new URL(baseUrl).origin) return false;
  if (entry && routeMode === 'hash' && url.pathname !== new URL(entry).pathname) return false;
  if (condition?.not) return !(await matchesReady(page, condition.not, {baseUrl, routeMode, entry}));
  if (condition?.all) {
    if (!Array.isArray(condition.all) || !condition.all.length) throw Error('ready.all 必须是非空数组');
    for (const part of condition.all) if (!(await matchesReady(page, part, {baseUrl, routeMode, entry}))) return false;
    return true;
  }
  if (condition?.route !== undefined)
    return (routeMode === 'hash' ? url.hash.slice(1).split('?')[0] || '/' : url.pathname) === condition.route;
  return locator(page, condition).filter({visible: true}).first().isVisible();
}
export async function waitReady(page, condition, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 15000);
  do {
    await enableFlutterSemantics(page);
    if (await matchesReady(page, condition, options)) return;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  throw Error('页面就绪判据未成立，请检查路由、身份及正文');
}
export async function executeSteps(page, steps = [], options) {
  if (!Array.isArray(steps)) throw Error('操作步骤必须是数组');
  for (const step of steps) {
    const action = step.action ?? ['goto', 'click', 'fill', 'wait'].find(key => step[key] !== undefined);
    await enableFlutterSemantics(page);
    switch (action) {
      case 'goto': {
        const url = webUrl(step.url ?? step.goto, options.baseUrl);
        if (url.origin !== new URL(options.baseUrl).origin) throw Error('操作地址必须与应用同源');
        await page.goto(url.href, {waitUntil: 'domcontentloaded'});
        // 普通 Flutter 启动及语义挂接晚于 DOMContentLoaded。
        await page.locator('body').waitFor();
        break;
      }
      case 'click':
        await (await unique(page, step.target ?? step.click, options)).click();
        break;
      case 'fill':
        await fillField(page, step.target ?? step.fill, step.value, options);
        break;
      case 'wait':
        await waitReady(page, step.ready ?? step.wait, options);
        break;
      default:
        throw Error('操作只支持 goto/click/fill/wait');
    }
    if (new URL(page.url()).origin !== new URL(options.baseUrl).origin) throw Error('操作离开应用来源');
  }
}

export function validateCondition(condition, depth = 0) {
  if (!condition || typeof condition !== 'object' || depth > 20) throw Error('页面判据无效');
  if (condition.any !== undefined) {
    if (!Array.isArray(condition.any) || !condition.any.length) throw Error('定位器 any 必须是非空数组');
    for (const part of condition.any) {
      validateCondition(part, depth + 1);
      if (part.all || part.not || part.route) throw Error('any 只接受定位器');
    }
  } else if (condition.all !== undefined) {
    if (!Array.isArray(condition.all) || !condition.all.length) throw Error('ready.all 必须是非空判据数组');
    for (const part of condition.all) validateCondition(part, depth + 1);
  } else if (condition.not !== undefined) validateCondition(condition.not, depth + 1);
  else if (condition.route !== undefined) {
    if (typeof condition.route !== 'string' || !condition.route.startsWith('/')) throw Error('路由判据无效');
  } else {
    const kind = condition.kind ?? (condition.label ? 'label' : condition.role ? 'role' : 'text');
    if (
      !['label', 'role', 'text'].includes(kind) ||
      typeof (condition.name ?? condition.text ?? condition.label) !== 'string' ||
      !(condition.name ?? condition.text ?? condition.label).trim() ||
      (kind === 'role' && (typeof condition.role !== 'string' || !condition.role.trim()))
    )
      throw Error('页面定位判据必须指定 label、role/name 或 text');
  }
}
export function validateSteps(steps, baseUrl) {
  if (steps === undefined) return;
  if (!Array.isArray(steps)) throw Error('操作步骤必须是数组');
  for (const step of steps) {
    const action = step?.action ?? ['goto', 'click', 'fill', 'wait'].find(key => step?.[key] !== undefined);
    if (action === 'goto') {
      const url = webUrl(step.url ?? step.goto, baseUrl);
      if (url.origin !== new URL(baseUrl).origin) throw Error('操作地址必须与应用同源');
    } else if (action === 'wait') validateCondition(step.ready ?? step.wait);
    else if (action === 'click' || action === 'fill') {
      const target = step.target ?? step[action];
      validateCondition(target);
      if (target.all || target.not || target.route) throw Error('操作目标必须是定位器');
      if (action === 'fill' && typeof step.value !== 'string') throw Error('输入操作需要文字 value');
    } else throw Error('操作只支持 goto/click/fill/wait');
  }
}
