import {useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject} from 'react';
import {IconEye, IconEyeOff, IconX} from '@tabler/icons-react';
import {AuthenticationFields} from './AuthenticationFields';
import mark from './assets/atlas-mark.png';
import {createDraft, credentialsMatch, normalizeDraft, validateDraft} from './model';
import type {ConfigAdapter, LoginResult, LoginStatus, Project, Role, RoleDraft} from './types';

const statusLabels: Record<LoginStatus, string> = {
  passed: '已通过', untested: '未测试', unconfigured: '待配置', failed: '未通过',
};

function Toggle({checked, onChange, label, disabled = false}: {
  checked: boolean; onChange(value: boolean): void; label: string; disabled?: boolean;
}) {
  return <button className="toggle" type="button" role="switch" aria-checked={checked}
    aria-label={label} disabled={disabled} onClick={event => {
      event.stopPropagation(); onChange(!checked);
    }}><span className="toggle-thumb"/></button>;
}

function Field({label, name, value, onChange, error, disabled, placeholder, children, inputRef}: {
  label: string; name: string; value: string; onChange(value: string): void; error?: string;
  disabled?: boolean; placeholder?: string; children?: ReactNode;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return <div className={`field ${error ? 'has-error' : ''}`}>
    <label htmlFor={name}>{label}</label>
    <input ref={inputRef} id={name} name={name} value={value} disabled={disabled}
      placeholder={placeholder} autoComplete="off" spellCheck={false}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined}
      onChange={event => onChange(event.target.value)}/>
    {error && <p className="field-error" id={`${name}-error`}>{error}</p>}
    {children}
  </div>;
}

export function ConfigPage({adapter}: {adapter: ConfigAdapter}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [project, setProject] = useState<Project>({name: '', baseUrl: '', authentication: {type: 'none'}, allowRemoteUrls: false, revision: ''});
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [drawer, setDrawer] = useState<'role' | 'project' | null>(null);
  const [draft, setDraft] = useState<RoleDraft>(createDraft());
  const [baseline, setBaseline] = useState('');
  const [projectDraft, setProjectDraft] = useState(project);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [login, setLogin] = useState<LoginResult | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<(() => void) | null>(null);
  const request = useRef(0);
  const firstField = useRef<HTMLInputElement>(null);
  const drawerHeading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const toast = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardDialog = useRef<HTMLElement>(null);
  const current = roles.find(role => role.id === draft.id);
  const dirty = loaded && (drawer === 'project'
    ? JSON.stringify(projectDraft) !== JSON.stringify(project)
    : drawer === 'role' && JSON.stringify(draft) !== baseline);

  function notify(text: string) {
    if (toast.current) clearTimeout(toast.current);
    setMessage(text);
    toast.current = setTimeout(() => setMessage(''), 4500);
  }

  function applyRole(role: Role) {
    setRoles(previous => previous.some(item => item.id === role.id)
      ? previous.map(item => item.id === role.id ? role : item) : [...previous, role]);
  }

  useEffect(() => {
    let active = true;
    setLoaded(false);
    adapter.load().then(value => {
      if (!active) return;
      setRoles(value.roles); setProject(value.project); setProjectDraft(value.project);
      const initial = createDraft(value.roles[0]);
      setDrawer(value.roles.length ? 'role' : null);
      setDraft(initial); setBaseline(JSON.stringify(initial));
      setLoadError(''); setLoaded(true);
    }).catch(() => { if (active) setLoadError('读取配置失败，请重新加载页面。'); });
    return () => { active = false; request.current++; if (toast.current) clearTimeout(toast.current); };
  }, [adapter]);

  useEffect(() => {
    let active = true;
    const check = () => adapter.health().then(() => { if (active) { setConnected(true); setConnectionError(''); } })
      .catch((error: Error) => { if (active) { setConnected(false); setConnectionError(error.message); } });
    void check(); const timer = setInterval(() => void check(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [adapter]);

  function invalidateLogin() {
    request.current++; setTesting(false); setLogin(null);
  }

  function focusAfterRender(action: () => void) {
    const previous = document.activeElement;
    requestAnimationFrame(() => {
      if (document.activeElement === previous || document.activeElement === document.body) action();
    });
  }

  function change<K extends keyof RoleDraft>(key: K, value: RoleDraft[K]) {
    const next = {...draft, [key]: value, ...(key === 'password' ? {clearPassword: false} : {})};
    if (!credentialsMatch(draft, next)) invalidateLogin();
    setDraft(next);
    setErrors(previous => ({...previous, [key]: ''}));
  }

  function close() {
    invalidateLogin(); setDrawer(null); setErrors({}); setShowPassword(false);
    focusAfterRender(() => trigger.current?.focus());
  }

  function navigate(action: () => void) {
    if (saving) return;
    if (dirty) setPendingIntent(() => action);
    else action();
  }

  function edit(role?: Role) {
    trigger.current = document.activeElement as HTMLElement;
    navigate(() => {
      const next = createDraft(role);
      invalidateLogin(); setDraft(next); setBaseline(JSON.stringify(next));
      setErrors({}); setShowPassword(false); setDrawer('role');
      focusAfterRender(() => role ? drawerHeading.current?.focus() : firstField.current?.focus());
    });
  }

  function editProject() {
    trigger.current = document.activeElement as HTMLElement;
    navigate(() => {
      invalidateLogin(); setProjectDraft(project); setErrors({}); setDrawer('project');
      focusAfterRender(() => drawerHeading.current?.focus());
    });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || saving) return;
      if (deleting) setDeleting(false);
      else if (pendingIntent) setPendingIntent(null);
      else if (drawer) navigate(close);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!pendingIntent && !deleting) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = discardDialog.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'));
      const target = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
      if (document.activeElement === target) {
        event.preventDefault();
        (event.shiftKey ? buttons[buttons.length - 1] : buttons[0])?.focus();
      }
    }
    dialog?.addEventListener('keydown', trap);
    return () => { dialog?.removeEventListener('keydown', trap); previous?.focus(); };
  }, [pendingIntent, deleting]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateDraft(draft, roles);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      focusAfterRender(() => document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true); request.current++; setTesting(false);
    try {
      const role = await adapter.saveRole({...normalizeDraft(draft), checkId: login?.checkId});
      applyRole(role);
      setBaseline(JSON.stringify(draft)); close();
      notify(`已保存「${role.name}」。`);
    } catch (error) {
      setErrors(previous => ({...previous, general: error instanceof Error ? error.message : '保存失败，请重试；原配置未被替换。'}));
    } finally { setSaving(false); }
  }

  async function testLogin() {
    if (!draft.username.trim()) {
      setErrors(previous => ({...previous, username: '请先填写登录账号。'})); return;
    }
    if (draft.clearPassword || (!draft.password && !current?.passwordSet)) {
      setErrors(previous => ({...previous, password: '请先填写登录密码。'})); return;
    }
    const revision = ++request.current;
    setTesting(true); setLogin(null);
    try {
      const result = await adapter.testLogin(normalizeDraft(draft));
      if (revision === request.current) setLogin(result);
    } catch {
      if (revision === request.current) setLogin({status: 'failed', message: '登录测试暂不可用，请重试。'});
    } finally { if (revision === request.current) setTesting(false); }
  }

  async function toggleRole(role: Role, enabled: boolean) {
    setPendingToggle(role.id);
    try {
      const saved = await adapter.setEnabled(role.id, enabled);
      applyRole(saved);
      notify(`${role.name}已${enabled ? '启用' : '停用'}。`);
    } catch { notify('切换失败，已保留原状态，请重试。'); }
    finally { setPendingToggle(null); }
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault(); setSaving(true); setErrors({});
    try {
      const saved = await adapter.saveProject(projectDraft);
      const snapshot = await adapter.load();
      setProject(saved); setRoles(snapshot.roles); close();
      notify('应用设置已更新。');
    } catch (error) { setErrors({general: error instanceof Error ? error.message : '保存失败，请检查应用设置后重试。'}); }
    finally { setSaving(false); }
  }

  async function deleteRole() {
    if (!current) return;
    setSaving(true);
    try {
      await adapter.deleteRole(current.id, current.revision);
      setRoles(previous => previous.filter(role => role.id !== current.id));
      setDeleting(false); close(); notify('角色及其本机凭据已删除。');
    } catch (error) { setDeleting(false); setErrors({general: error instanceof Error ? error.message : '删除失败，请重试。'}); }
    finally { setSaving(false); }
  }

  return <div className="config-app">
    <header className="app-header">
      <div className="brand">
        <img className="brand-logo" src={mark} width="48" height="48" alt=""/>
        <div><div className="brand-title">Flutter UI Atlas <span>本地配置</span></div>
          <p>配置采集身份，构建路由全貌</p></div>
      </div>
      <span className="preview-label">{connected ? '已连接本机配置服务' : '配置服务已断开'}</span>
    </header>

    {!connected && <div className="connection-error" role="alert">{connectionError}</div>}
    {message && <div className="toast" role="status">{message}</div>}
    <div className={`workspace ${drawer ? 'with-drawer' : ''}`}>
      <main className="role-main">
        <nav className="breadcrumb" aria-label="配置导航"><button onClick={editProject} disabled={!loaded || saving || !connected}>应用设置</button>
          <span aria-hidden="true">/</span><span aria-current="page">角色与账号</span></nav>
        <div className="section-heading"><div><h1>角色与账号</h1><p>为不同身份配置自动采集账号。</p></div>
          <button className="button primary add-role" onClick={() => edit()} disabled={!loaded || saving || !connected}>新增角色</button></div>

        {loadError ? <div className="empty-state" role="alert">{loadError}<button className="button" onClick={() => location.reload()}>重新加载</button></div>
          : !loaded ? <p className="loading" role="status">正在读取配置…</p>
          : roles.length ? <div className="table-scroll"><table className="role-table">
            <colgroup><col className="col-name"/><col className="col-tag"/><col className="col-account"/><col className="col-status"/><col className="col-enabled"/></colgroup>
            <thead><tr><th scope="col">角色</th><th scope="col">Tag</th><th scope="col">登录账号</th><th scope="col">登录测试</th><th scope="col">自动采集</th></tr></thead>
            <tbody>{roles.map(role => <tr key={role.id} data-selected={drawer === 'role' && draft.id === role.id}
              onClick={() => edit(role)}>
              <td><button className="role-name" type="button" aria-label={`编辑${role.name}`}
                aria-current={drawer === 'role' && draft.id === role.id ? 'true' : undefined} title={role.name}>{role.name}</button></td>
              <td><code className="tag" title={role.tag}>{role.tag}</code></td>
              <td className="account-cell"><span title={role.username}>{role.username}</span></td>
              <td><span className={`login-status ${role.testStatus}`}>{statusLabels[role.testStatus]}</span></td>
              <td><Toggle checked={role.enabled} label={`${role.name}自动采集`} disabled={pendingToggle !== null || saving || !connected}
                onChange={value => void toggleRole(role, value)}/></td>
            </tr>)}</tbody>
          </table></div>
          : <div className="empty-state"><h2>先添加一个采集角色</h2><p>添加角色后，可保存本机凭据并测试登录。</p>
            <button className="button primary" onClick={() => edit()}>新增角色</button></div>}

        <footer className="main-footer"><p>配置和凭据仅保存在当前工程的本机目录。</p><small>当前版本支持配置与登录测试，按角色自动采集尚未接入。</small></footer>
      </main>

      {drawer && <aside className="editor" aria-label={drawer === 'project' ? '应用设置' : draft.id ? '编辑角色' : '新增角色'}>
        <div className="editor-header"><h2 ref={drawerHeading} tabIndex={-1}>{drawer === 'project' ? '应用设置' : draft.id ? '编辑角色' : '新增角色'}</h2>
          <button className="icon-button" aria-label="关闭编辑栏" disabled={saving || !connected} onClick={() => navigate(close)}><IconX size={24} stroke={1.6}/></button></div>
        {drawer === 'role' ? <form className="editor-form" onSubmit={save} noValidate>
          <div className="editor-content">
            <Field inputRef={firstField} name="role-tag" label="Tag" value={draft.tag} error={errors.tag} disabled={saving || !connected}
              onChange={value => change('tag', value)} placeholder="例如 admin"/>
            <Field name="role-name" label="显示名称" value={draft.name} error={errors.name} disabled={saving || !connected}
              onChange={value => change('name', value)} placeholder="例如 管理员"/>
            <Field name="role-username" label="登录账号" value={draft.username} error={errors.username} disabled={saving || !connected}
              onChange={value => change('username', value)} placeholder="请输入用户名"/>
            <div className={`field password-field ${errors.password ? 'has-error' : ''}`}>
              <label htmlFor="role-password">登录密码</label>
              <div className="password-control"><input id="role-password" type={showPassword ? 'text' : 'password'}
                value={draft.password} disabled={saving || !connected} autoComplete="off" aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : 'password-help'}
                placeholder={current?.passwordSet && !draft.clearPassword ? '已保存密码，留空保持' : '请输入登录密码'}
                onChange={event => change('password', event.target.value)}/>
                <button className="icon-button" type="button" disabled={saving || !connected} aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
                  {showPassword ? <IconEyeOff size={22} stroke={1.6}/> : <IconEye size={22} stroke={1.6}/>}</button></div>
              {errors.password && <p className="field-error" id="password-error">{errors.password}</p>}
              <div id="password-help" className="password-help">
                {current?.passwordSet ? <button type="button" className="text-button" disabled={saving || !connected}
                  onClick={() => {
                    invalidateLogin(); setDraft(value => ({...value, password: '', clearPassword: !value.clearPassword}));
                  }}>{draft.clearPassword ? '撤销清除密码' : '清除已保存密码'}</button> : <span>密码仅保存在本机，列表不会回显。</span>}
              </div>
            </div>
            <section className="test-section" aria-label="登录测试"><h3>登录测试</h3>
              <div className="test-row"><span className={`test-label ${login?.status ?? ''}`} role="status">
                {testing ? '正在测试…' : login ? login.status === 'passed' ? '测试通过' : '测试未通过' : '尚未测试'}</span>
                <button type="button" className="button" disabled={testing || saving || !connected} onClick={() => void testLogin()}>{testing ? '测试中…' : '测试登录'}</button></div>
              {login && <p className={`test-message ${login.status}`} role={login.status === 'failed' ? 'alert' : undefined}>{login.message}</p>}
            </section>
            <p className="privacy-note">凭据以受限本机文件保存，未进行磁盘加密。</p>
            {current && <button type="button" className="text-button danger" disabled={saving || !connected} onClick={() => setDeleting(true)}>删除角色</button>}
            {errors.general && <p className="form-error" role="alert">{errors.general}</p>}
          </div>
          <div className="editor-actions"><button type="button" className="button" disabled={saving || !connected} onClick={() => navigate(close)}>取消</button>
            <button type="submit" className="button primary" disabled={saving || testing || !connected || pendingToggle !== null}>{saving ? '保存中…' : '保存角色'}</button></div>
        </form> : <form className="editor-form" onSubmit={saveProject} noValidate>
          <div className="editor-content"><p className="project-intro">所有角色共用应用连接设置。</p>
            <Field name="project-name" label="应用名称" value={projectDraft.name} disabled={saving || !connected}
              onChange={value => setProjectDraft(previous => ({...previous, name: value}))}/>
            <Field name="project-url" label="Flutter Web 地址" value={projectDraft.baseUrl} disabled={saving || !connected}
              onChange={value => setProjectDraft(previous => ({...previous, baseUrl: value}))}/>
            <label className="remote-option"><input type="checkbox" checked={projectDraft.allowRemoteUrls} disabled={saving || !connected}
              onChange={event => setProjectDraft(previous => ({...previous, allowRemoteUrls: event.target.checked}))}/>允许访问远程应用地址</label>
            <AuthenticationFields value={projectDraft.authentication} disabled={saving || !connected}
              onChange={authentication => setProjectDraft(previous => ({...previous, authentication}))}/>
            <p className="privacy-note">应用地址或登录方式变化后，需要重新测试各角色的登录。</p>
            {errors.general && <p className="form-error" role="alert">{errors.general}</p>}
          </div><div className="editor-actions"><button className="button" type="button" disabled={saving || !connected} onClick={() => navigate(close)}>取消</button>
            <button className="button primary" type="submit" disabled={saving || !connected}>{saving ? '保存中…' : '保存设置'}</button></div>
        </form>}
      </aside>}
    </div>
    {deleting && <div className="dialog-backdrop"><section ref={discardDialog} className="discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
      <h2 id="delete-title">删除角色？</h2><p>删除该角色及其本机凭据，历史图谱会保留。</p>
      <div><button className="button" autoFocus disabled={saving} onClick={() => setDeleting(false)}>取消删除</button>
        <button className="button primary" disabled={saving || !connected} onClick={() => void deleteRole()}>确认删除</button></div>
    </section></div>}
    {pendingIntent && <div className="dialog-backdrop"><section ref={discardDialog} className="discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description">
      <h2 id="discard-title">放弃未保存的更改？</h2><p id="discard-description">当前编辑还没有保存，离开后将丢弃这些更改。</p>
      <div><button className="button" autoFocus onClick={() => setPendingIntent(null)}>继续编辑</button>
        <button className="button primary" onClick={() => { const action = pendingIntent; setPendingIntent(null); action(); }}>放弃更改</button></div>
    </section></div>}
  </div>;
}
