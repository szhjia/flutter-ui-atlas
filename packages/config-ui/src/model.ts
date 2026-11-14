import type {Role, RoleDraft} from './types';

export function createDraft(role?: Role): RoleDraft {
  return {
    id: role?.id,
    revision: role?.revision,
    tag: role?.tag ?? '',
    name: role?.name ?? '',
    username: role?.username ?? '',
    password: '',
    clearPassword: false
  };
}

export function normalizeDraft(draft: RoleDraft): RoleDraft {
  return {...draft, tag: draft.tag.trim(), name: draft.name.trim(), username: draft.username.trim()};
}

export function validateDraft(draft: RoleDraft, roles: Role[]): Record<string, string> {
  const value = normalizeDraft(draft);
  const errors: Record<string, string> = {};
  if (!/^[a-z][a-z0-9_-]{0,47}$/.test(value.tag)) {
    errors.tag = '使用小写字母开头，可包含数字、下划线和连字符，最多 48 字符。';
  } else if (roles.some(role => role.id !== value.id && role.tag === value.tag)) {
    errors.tag = '这个 Tag 已被使用，请换一个。';
  }
  if (!value.name) errors.name = '请输入角色的显示名称。';
  else if (value.name.length > 64) errors.name = '显示名称最多 64 字符。';
  if (!value.username) errors.username = '请输入登录账号。';
  return errors;
}

export function credentialsMatch(a: RoleDraft, b: RoleDraft) {
  return (
    a.id === b.id &&
    a.tag === b.tag &&
    a.username === b.username &&
    a.password === b.password &&
    a.clearPassword === b.clearPassword
  );
}
