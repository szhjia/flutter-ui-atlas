import type {Page} from 'playwright';

export type LoginStatus = 'passed' | 'failed' | 'untested' | 'unconfigured';
export interface LocatorSpec {
  kind: 'label' | 'role' | 'text';
  name: string;
  role?: string;
}
export type Authentication =
  | {type: 'none'}
  | {
      type: 'form';
      loginUrl: string;
      username: LocatorSpec;
      password: LocatorSpec;
      submit: LocatorSpec;
      success: LocatorSpec;
      failure?: LocatorSpec;
    }
  | {type: 'module'; module: string};
export interface Role {
  id: string;
  tag: string;
  name: string;
  enabled: boolean;
  username: string;
  passwordSet: boolean;
  testStatus: LoginStatus;
  revision: string;
}
export interface RoleDraft {
  id?: string;
  revision?: string;
  tag: string;
  name: string;
  username: string;
  password: string;
  clearPassword: boolean;
  checkId?: string;
}
export interface Project {
  name: string;
  baseUrl: string;
  authentication: Authentication;
  allowRemoteUrls: boolean;
  revision: string;
}
export interface LoginResult {
  status: 'passed' | 'failed';
  message: string;
  checkId?: string;
}
export interface ConfigAdapter {
  load(): Promise<{roles: Role[]; project: Project}>;
  saveRole(draft: RoleDraft): Promise<Role>;
  setEnabled(id: string, enabled: boolean): Promise<Role>;
  deleteRole(id: string, revision: string): Promise<void>;
  testLogin(draft: RoleDraft): Promise<LoginResult>;
  saveProject(project: Project): Promise<Project>;
  health(): Promise<void>;
}
/** 本地可信模块：login 执行操作，verify 必须检查页面此刻的认证证据。 */
export interface AuthenticationAdapter {
  version: string;
  login(input: {
    page: Page;
    role: {tag: string};
    credentials: {username: string; password: string};
    baseUrl: string;
  }): Promise<void>;
  verify(input: {page: Page; role: {tag: string}}): Promise<{authenticated: boolean; identityMatches?: boolean}>;
}
