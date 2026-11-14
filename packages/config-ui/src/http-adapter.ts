import type {ConfigAdapter, Project, Role, LoginResult} from './types';

export function createHttpAdapter(): ConfigAdapter {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  async function request<T>(path: string, input?: unknown): Promise<T> {
    let response;
    try {
      response = await fetch(`/api/${path}`, {
        method: input === undefined ? 'GET' : 'POST',
        headers: {'X-Atlas-Token': token, ...(input === undefined ? {} : {'Content-Type': 'application/json'})},
        ...(input === undefined ? {} : {body: JSON.stringify(input)})
      });
    } catch {
      throw Error('配置服务已断开，请重新运行 atlas config 并打开终端中的入口。');
    }
    const value = await response.json();
    if (!response.ok) throw Error(value.message ?? '配置操作失败，请重试。');
    return value as T;
  }
  return {
    load: () => request<{roles: Role[]; project: Project}>('config'),
    saveRole: draft => request<Role>('role', draft),
    setEnabled: (id, enabled) => request<Role>('enabled', {id, enabled}),
    deleteRole: async (id, revision) => {
      await request('delete-role', {id, revision});
    },
    testLogin: draft => request<LoginResult>('test-login', draft),
    saveProject: project => request<Project>('project', project),
    health: async () => {
      await request('health');
    }
  };
}
