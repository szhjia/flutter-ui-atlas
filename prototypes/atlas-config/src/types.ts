export type LoginStatus = 'passed' | 'untested' | 'unconfigured' | 'failed';

export interface Role {
  id: string;
  tag: string;
  name: string;
  username: string;
  passwordSet: boolean;
  enabled: boolean;
  testStatus: LoginStatus;
}

export interface RoleDraft {
  id?: string;
  tag: string;
  name: string;
  username: string;
  password: string;
  clearPassword: boolean;
}

export interface Project {
  name: string;
  baseUrl: string;
}

export interface LoginResult {
  status: 'passed' | 'failed';
  message: string;
}

/** 生产接入可替换此接口；页面不读取或回显已保存的密码。 */
export interface ConfigAdapter {
  mode: 'preview' | 'connected';
  load(): Promise<{roles: Role[]; project: Project}>;
  /** 只保存角色编辑字段；已有角色的启停状态由 setEnabled 独立维护。 */
  saveRole(draft: RoleDraft): Promise<Role>;
  setEnabled(id: string, enabled: boolean): Promise<Role>;
  testLogin(draft: RoleDraft): Promise<LoginResult>;
  saveProject(project: Project): Promise<Project>;
}
