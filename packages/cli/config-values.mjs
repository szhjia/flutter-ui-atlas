import {createHash} from 'node:crypto';
import {webUrl} from '../capture/declarative.mjs';
import {assertLoopback} from '../capture/web-boundary.mjs';

export class ConfigError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const conflict = () => new ConfigError('配置已被其他编辑修改，请重新加载后再保存。', 409);
export function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function text(value, label, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new ConfigError(`${label}不能为空或超出长度限制。`);
  return value.trim();
}
export function locatorSpec(value, label) {
  if (!object(value) || !['label', 'role', 'text'].includes(value.kind))
    throw new ConfigError(`${label}的定位方式无效。`);
  const result = {kind: value.kind, name: text(value.name, label, 512)};
  if (value.kind === 'role') result.role = text(value.role, `${label}的 role`, 80);
  return result;
}
export function projectValue(input) {
  if (!object(input)) throw new ConfigError('应用设置必须是对象。');
  const name = text(input.name, '应用名称', 128);
  let base;
  try {
    base = webUrl(input.baseUrl);
  } catch {
    throw new ConfigError('请输入不含账号密码的完整 HTTP(S) 应用地址。');
  }
  if (typeof input.allowRemoteUrls !== 'boolean') throw new ConfigError('远程地址开关必须是布尔值。');
  try {
    assertLoopback(base, {allowRemote: input.allowRemoteUrls, message: '远程应用地址需要显式开启允许远程地址。'});
  } catch {
    throw new ConfigError('远程应用地址需要显式开启允许远程地址。');
  }
  const auth = input.authentication;
  let authentication;
  if (auth?.type === 'none') authentication = {type: 'none'};
  else if (auth?.type === 'module') {
    const module = text(auth.module, '可信本地模块路径');
    if (!module.endsWith('.mjs')) throw new ConfigError('认证模块必须是可信本地 .mjs 文件。');
    authentication = {type: 'module', module};
  } else if (auth?.type === 'form') {
    let login;
    try {
      login = webUrl(auth.loginUrl, base);
    } catch {
      throw new ConfigError('登录地址必须是无凭据的 HTTP(S) 地址。');
    }
    if (login.origin !== base.origin)
      throw new ConfigError('通用表单的登录地址必须与应用同源，复杂流程请使用本地认证模块。');
    authentication = {
      type: 'form',
      loginUrl: login.href,
      username: locatorSpec(auth.username, '账号字段'),
      password: locatorSpec(auth.password, '密码字段'),
      submit: locatorSpec(auth.submit, '提交按钮'),
      success: locatorSpec(auth.success, '成功判据'),
      ...(auth.failure && !(typeof auth.failure.name === 'string' && !auth.failure.name.trim())
        ? {failure: locatorSpec(auth.failure, '失败判据')}
        : {})
    };
  } else throw new ConfigError('请选择有效的登录方式。');
  return {name, baseUrl: base.href, allowRemoteUrls: input.allowRemoteUrls, authentication};
}
export function roleValue(input) {
  if (!object(input)) throw new ConfigError('角色设置必须是对象。');
  const tag = text(input.tag, 'Tag', 48);
  if (!/^[a-z][a-z0-9_-]{0,47}$/.test(tag))
    throw new ConfigError('Tag 使用小写字母开头，可包含数字、下划线和连字符，最多 48 字符。');
  if (typeof input.password !== 'string' || input.password.length > 8192 || typeof input.clearPassword !== 'boolean') {
    throw new ConfigError('密码编辑参数无效。');
  }
  return {...input, tag, name: text(input.name, '显示名称', 64), username: text(input.username, '登录账号', 512)};
}
