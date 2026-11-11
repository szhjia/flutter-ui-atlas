import {normalizeDraft, validateDraft} from './model';
import type {ConfigAdapter, LoginResult, Project, Role, RoleDraft} from './types';

/** 演示数据与改动只存在内存中；不请求应用、不读取磁盘、不使用 localStorage。 */
export function createDemoAdapter(): ConfigAdapter {
  let roles: Role[] = [
    {id: 'demo-admin', tag: 'admin', name: '管理员', username: 'admin@example.test',
      passwordSet: true, enabled: true, testStatus: 'passed'},
    {id: 'demo-member', tag: 'member', name: '普通用户', username: 'member@example.test',
      passwordSet: true, enabled: true, testStatus: 'untested'},
    {id: 'demo-reviewer', tag: 'reviewer', name: '审核员', username: 'reviewer@example.test',
      passwordSet: false, enabled: false, testStatus: 'unconfigured'},
  ];
  let project: Project = {name: '示例 Flutter 应用', baseUrl: 'http://localhost:8080'};
  const passwords = new Map([['demo-admin', 'atlas-demo'], ['demo-member', 'atlas-demo']]);
  const checks = new Map<string, {credentials: string; status: LoginResult['status']}>();
  const delay = () => new Promise<void>(resolve => setTimeout(resolve, 400));
  const clone = <T,>(value: T): T => structuredClone(value);
  const credentialKey = (draft: RoleDraft) => JSON.stringify([
    draft.username.trim(), draft.clearPassword ? '' : draft.password || passwords.get(draft.id ?? '') || '',
  ]);

  return {
    mode: 'preview',
    async load() { return clone({roles, project}); },
    async testLogin(draft) {
      await delay();
      const password = draft.clearPassword ? '' : draft.password || passwords.get(draft.id ?? '') || '';
      let result: LoginResult;
      if (!draft.username.trim() || !password) {
        result = {status: 'failed', message: '请先填写账号和密码。示例密码为 atlas-demo。'};
      } else if (password !== 'atlas-demo') {
        result = {status: 'failed', message: '演示登录未通过，请使用示例密码 atlas-demo。'};
      } else {
        result = {status: 'passed', message: '演示测试通过；尚未连接真实 Flutter 应用。'};
      }
      checks.set(draft.id ?? 'new', {credentials: credentialKey(draft), status: result.status});
      return result;
    },
    async saveRole(input) {
      const draft = normalizeDraft(input);
      const errors = validateDraft(draft, roles);
      if (Object.keys(errors).length) throw Error(Object.values(errors)[0]);
      await delay();
      const previous = roles.find(role => role.id === draft.id);
      if (draft.id && !previous) throw Error('角色已不存在，请重新选择。');
      const id = previous?.id ?? crypto.randomUUID();
      const nextPassword = draft.clearPassword ? '' : draft.password || passwords.get(id) || '';
      const authenticationChanged = !previous || previous.username !== draft.username ||
        nextPassword !== passwords.get(id);
      const check = checks.get(draft.id ?? 'new');
      const role: Role = {
        id, tag: draft.tag, name: draft.name, username: draft.username,
        enabled: previous?.enabled ?? true, passwordSet: Boolean(nextPassword),
        testStatus: !nextPassword ? 'unconfigured' : check?.credentials === credentialKey(draft) ? check.status :
          authenticationChanged ? 'untested' : previous?.testStatus ?? 'untested',
      };
      if (nextPassword) passwords.set(id, nextPassword);
      else passwords.delete(id);
      roles = previous ? roles.map(item => item.id === id ? role : item) : [...roles, role];
      checks.delete('new');
      return clone(role);
    },
    async setEnabled(id, enabled) {
      await delay();
      const role = roles.find(item => item.id === id);
      if (!role) throw Error('角色已不存在，请重新加载。');
      roles = roles.map(item => item.id === id ? {...item, enabled} : item);
      return clone({...role, enabled});
    },
    async saveProject(value) {
      let url: URL;
      try { url = new URL(value.baseUrl); }
      catch { throw Error('请输入完整的 HTTP 或 HTTPS 应用地址。'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw Error('应用地址应为不含账号密码的 HTTP 或 HTTPS 地址。');
      }
      if (!value.name.trim()) throw Error('请输入应用名称。');
      await delay();
      const changed = value.baseUrl.trim() !== project.baseUrl;
      project = {name: value.name.trim(), baseUrl: value.baseUrl.trim()};
      if (changed) {
        roles = roles.map(role => ({...role, testStatus: role.passwordSet ? 'untested' : 'unconfigured'}));
        checks.clear();
      }
      return clone(project);
    },
  };
}
