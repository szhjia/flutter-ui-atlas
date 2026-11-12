import {validateCondition, validateSteps} from './browser-actions.mjs';
import {webUrl, validateRoutePrefix} from '../capture/declarative.mjs';
import {assertLoopback} from '../capture/web-boundary.mjs';

const anonymous = {id: '@anonymous', name: '未登录', tag: '@anonymous'};
export function interpolate(value, role) {
  if (typeof value === 'string')
    return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const field = key.trim().replace(/^role\./, '');
      if (!['id', 'tag', 'name', 'username'].includes(field) || !key.trim().startsWith('role.'))
        throw Error('不支持的角色变量；密码不能进入声明式配置');
      return String(field === 'username' ? (role.credentials?.username ?? '') : (role[field] ?? ''));
    });
  if (Array.isArray(value)) return value.map(item => interpolate(item, role));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, role)]));
  return value;
}
export function expandCatalog(config, roles = []) {
  const base = webUrl(config.baseUrl);
  assertLoopback(base, {allowRemote: config.allowRemoteUrls === true});
  if (!Array.isArray(config.screens)) throw Error('screens 必须是页面数组');
  if (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1))
    throw Error('timeoutMs 必须是正整数');
  const enabled = roles.filter(role => role.enabled);
  const mode = config.routeMode ?? 'hash';
  if (!['hash', 'pathname'].includes(mode)) throw Error('routeMode 必须是 hash 或 pathname');
  const prefix = validateRoutePrefix(config.routePrefix);
  const ids = new Set();
  const screens = config.screens.flatMap(spec => {
    if (!spec.id || ids.has(spec.id)) throw Error('页面 ID 无效或重复');
    ids.add(spec.id);
    if (typeof spec.route !== 'string' || !/^\/(?!\/)[^?#]*$/.test(spec.route))
      throw Error('页面 route 必须是 / 开头的路由');
    if (
      spec.roles !== undefined &&
      (!Array.isArray(spec.roles) || !spec.roles.length || new Set(spec.roles).size !== spec.roles.length)
    )
      throw Error('页面角色必须是不重复的非空 Tag 数组');
    const selected =
      spec.roles === undefined
        ? roles.length
          ? enabled
          : [anonymous]
        : spec.roles.flatMap(tag => {
            if (tag === '@anonymous') return [anonymous];
            const role = roles.find(role => role.tag === tag);
            if (!role) throw Error(`页面角色未配置：${tag}`);
            return role.enabled ? [role] : [];
          });
    return selected.map(role => {
      if (
        role !== anonymous &&
        (!role.credentials?.username ||
          !role.credentials?.password ||
          !['form', 'module'].includes(config.authentication?.type))
      )
        throw Error('启用账户缺少凭据或认证配置');
      const value = interpolate(spec, role);
      validateCondition(value.ready);
      validateSteps(value.prepare, base.href);
      const entry = webUrl(value.entry ?? base.href, base);
      if (entry.origin !== base.origin) throw Error('页面入口必须与 baseUrl 同源');
      if (mode === 'hash') entry.hash = value.route;
      else {
        entry.pathname = prefix + value.route;
        const prefixPath = new URL(base);
        prefixPath.pathname = prefix + '/';
        if (prefix && !entry.pathname.startsWith(prefixPath.pathname))
          throw Error('页面 route 规范化后离开 routePrefix 目录');
      }
      return {
        ...value,
        id: `${role.id}:${spec.id}`,
        role: role.name,
        group: value.group ?? '页面',
        state: value.state ?? value.title,
        route: mode === 'pathname' ? entry.pathname : entry.hash.slice(1).split('?')[0] || '/',
        entry: entry.href,
        _role: role,
        _baseId: spec.id
      };
    });
  });
  if (!screens.length) throw Error('没有启用账户对应的页面，目录不能为空');
  const edges = (config.edges ?? []).flatMap(spec => {
    if (!ids.has(spec.source) || !ids.has(spec.target)) throw Error('连线引用了未知页面');
    return screens
      .filter(s => s._baseId === spec.source)
      .flatMap(from =>
        screens
          .filter(
            s =>
              s._baseId === spec.target &&
              (s._role.id === from._role.id || s._role === anonymous || from._role === anonymous)
          )
          .map(to => {
            const role = from._role === anonymous ? to._role : from._role;
            const value = interpolate(spec, role);
            validateSteps(value.steps ?? (value.click ? [{click: value.click}] : undefined), base.href);
            return {
              ...value,
              id: `${from._role.id}:${to._role.id}:${spec.id}`,
              source: from.id,
              target: to.id,
              _from: from,
              _to: to,
              verify: value.verify !== false && (value.steps !== undefined || value.click !== undefined)
            };
          })
      );
  });
  return {screens, edges};
}
