import {useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject} from 'react';
import {IconEye, IconEyeOff, IconX} from '@tabler/icons-react';
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
  const [project, setProject] = useState<Project>({name: '', baseUrl: ''});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [drawer, setDrawer] = useState<'role' | 'project' | null>('role');
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
      const initial = createDraft(value.roles.find(role => role.tag === 'reviewer') ?? value.roles[0]);
      setDraft(initial); setBaseline(JSON.stringify(initial));
      setLoadError(''); setLoaded(true);
    }).catch(() => { if (active) setLoadError('读取配置失败，请重新加载页面。'); });
    return () => { active = false; request.current++; if (toast.current) clearTimeout(toast.current); };
  }, [adapter]);

  function invalidateLogin() {
    request.current++; setTesting(false); setLogin(null);
  }

  function change<K extends keyof RoleDraft>(key: K, value: RoleDraft[K]) {
    const next = {...draft, [key]: value, ...(key === 'password' ? {clearPassword: false} : {})};
    if (!credentialsMatch(draft, next)) invalidateLogin();
    setDraft(next);
    setErrors(previous => ({...previous, [key]: ''}));
  }

  function close() {
    invalidateLogin(); setDrawer(null); setErrors({}); setShowPassword(false);
    requestAnimationFrame(() => trigger.current?.focus());
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
      requestAnimationFrame(() => role ? drawerHeading.current?.focus() : firstField.current?.focus());
    });
  }

  function editProject() {
    trigger.current = document.activeElement as HTMLElement;
    navigate(() => {
      invalidateLogin(); setProjectDraft(project); setErrors({}); setDrawer('project');
      requestAnimationFrame(() => drawerHeading.current?.focus());
    });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || saving) return;
      if (pendingIntent) setPendingIntent(null);
      else if (drawer) navigate(close);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!pendingIntent) return;
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
  }, [pendingIntent]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateDraft(draft, roles);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true); invalidateLogin();
    try {
      const role = await adapter.saveRole(normalizeDraft(draft));
      applyRole(role);
      setBaseline(JSON.stringify(draft)); close();
      notify(adapter.mode === 'preview' ? `已在本次预览中保存「${role.name}」。` : `已保存「${role.name}」。`);
    } catch {
      setErrors(previous => ({...previous, general: '保存失败，请重试；原配置未被替换。'}));
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
      notify(`${role.name}已${enabled ? '启用' : '停用'}自动采集${adapter.mode === 'preview' ? '（本次预览）' : ''}。`);
    } catch { notify('切换失败，已保留原状态，请重试。'); }
    finally { setPendingToggle(null); }
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault(); setSaving(true); setErrors({});
    try {
      const saved = await adapter.saveProject(projectDraft);
      const snapshot = await adapter.load();
      setProject(saved); setRoles(snapshot.roles); close();
      notify(adapter.mode === 'preview' ? '应用设置已在本次预览中更新。' : '应用设置已更新。');
    } catch { setErrors({general: '保存失败，请检查应用名称和 HTTP(S) 地址后重试。'}); }
    finally { setSaving(false); }
  }

  return <div className="config-app">
    <header className="app-header">
      <div className="brand">
        <img className="brand-logo" src="/assets/atlas-mark.png" width="48" height="48" alt=""/>
        <div><div className="brand-title">Flutter UI Atlas <span>本地配置</span></div>
          <p>配置采集身份，构建路由全貌</p></div>
      </div>
      {adapter.mode === 'preview' && <span className="preview-label" title="更改仅在本次页面会话有效，不保存真实凭据">交互预览 · 示例账号</span>}
    </header>

    {message && <div className="toast" role="status">{message}</div>}
    <div className={`workspace ${drawer ? 'with-drawer' : ''}`}>
      <main className="role-main">
        <nav className="breadcrumb" aria-label="配置导航"><button onClick={editProject} disabled={!loaded || saving}>应用设置</button>
          <span aria-hidden="true">/</span><span aria-current="page">角色与账号</span></nav>
        <div className="section-heading"><div><h1>角色与账号</h1><p>为不同身份配置自动采集账号。</p></div>
          <button className="button primary add-role" onClick={() => edit()} disabled={!loaded || saving}>新增角色</button></div>

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
              <td><Toggle checked={role.enabled} label={`${role.name}自动采集`} disabled={pendingToggle !== null || saving}
                onChange={value => void toggleRole(role, value)}/></td>
            </tr>)}</tbody>
          </table></div>
          : <div className="empty-state"><h2>先添加一个采集角色</h2><p>设置账号后，构建时会自动以该身份登录。</p>
            <button className="button primary" onClick={() => edit()}>新增角色</button></div>}

        <footer className="main-footer"><p>保存后在终端运行 <code>atlas build</code>。</p>
          {adapter.mode === 'preview' && <small>当前为交互预览，更改不会写入工程配置。</small>}</footer>
      </main>

      {drawer && <aside className="editor" aria-label={drawer === 'project' ? '应用设置' : draft.id ? '编辑角色' : '新增角色'}>
        <div className="editor-header"><h2 ref={drawerHeading} tabIndex={-1}>{drawer === 'project' ? '应用设置' : draft.id ? '编辑角色' : '新增角色'}</h2>
          <button className="icon-button" aria-label="关闭编辑栏" disabled={saving} onClick={() => navigate(close)}><IconX size={24} stroke={1.6}/></button></div>
        {drawer === 'role' ? <form className="editor-form" onSubmit={save} noValidate>
          <div className="editor-content">
            <Field inputRef={firstField} name="role-tag" label="Tag" value={draft.tag} error={errors.tag} disabled={saving}
              onChange={value => change('tag', value)} placeholder="例如 admin"/>
            <Field name="role-name" label="显示名称" value={draft.name} error={errors.name} disabled={saving}
              onChange={value => change('name', value)} placeholder="例如 管理员"/>
            <Field name="role-username" label="登录账号" value={draft.username} error={errors.username} disabled={saving}
              onChange={value => change('username', value)} placeholder="请输入用户名"/>
            <div className={`field password-field ${errors.password ? 'has-error' : ''}`}>
              <label htmlFor="role-password">登录密码</label>
              <div className="password-control"><input id="role-password" type={showPassword ? 'text' : 'password'}
                value={draft.password} disabled={saving} autoComplete="off" aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : 'password-help'}
                placeholder={current?.passwordSet && !draft.clearPassword ? '已保存密码，留空保持' : '请输入登录密码'}
                onChange={event => change('password', event.target.value)}/>
                <button className="icon-button" type="button" disabled={saving} aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
                  {showPassword ? <IconEyeOff size={22} stroke={1.6}/> : <IconEye size={22} stroke={1.6}/>}</button></div>
              {errors.password && <p className="field-error" id="password-error">{errors.password}</p>}
              <div id="password-help" className="password-help">
                {current?.passwordSet ? <button type="button" className="text-button" disabled={saving}
                  onClick={() => {
                    invalidateLogin(); setDraft(value => ({...value, password: '', clearPassword: !value.clearPassword}));
                  }}>{draft.clearPassword ? '撤销清除密码' : '清除已保存密码'}</button> : <span>示例密码：atlas-demo</span>}
              </div>
            </div>
            <section className="test-section" aria-label="登录测试"><h3>登录测试</h3>
              <div className="test-row"><span className={`test-label ${login?.status ?? ''}`} role="status">
                {testing ? '正在测试…' : login ? login.status === 'passed' ? '测试通过' : '测试未通过' : '尚未测试'}</span>
                <button type="button" className="button" disabled={testing || saving} onClick={() => void testLogin()}>{testing ? '测试中…' : '测试登录'}</button></div>
              {login && <p className={`test-message ${login.status}`} role={login.status === 'failed' ? 'alert' : undefined}>{login.message}</p>}
            </section>
            <p className="privacy-note">{adapter.mode === 'preview' ? '仅演示编辑与测试流程，不保存真实凭据。' : '凭据仅保存在本机。'}</p>
            {errors.general && <p className="form-error" role="alert">{errors.general}</p>}
          </div>
          <div className="editor-actions"><button type="button" className="button" disabled={saving} onClick={() => navigate(close)}>取消</button>
            <button type="submit" className="button primary" disabled={saving || testing}>{saving ? '保存中…' : '保存角色'}</button></div>
        </form> : <form className="editor-form" onSubmit={saveProject} noValidate>
          <div className="editor-content"><p className="project-intro">所有角色共用应用连接设置。</p>
            <Field name="project-name" label="应用名称" value={projectDraft.name} disabled={saving}
              onChange={value => setProjectDraft(previous => ({...previous, name: value}))}/>
            <Field name="project-url" label="Flutter Web 地址" value={projectDraft.baseUrl} disabled={saving}
              onChange={value => setProjectDraft(previous => ({...previous, baseUrl: value}))}/>
            <p className="privacy-note">应用地址变化后，需要重新测试各角色的登录。</p>
            {errors.general && <p className="form-error" role="alert">{errors.general}</p>}
          </div><div className="editor-actions"><button className="button" type="button" disabled={saving} onClick={() => navigate(close)}>取消</button>
            <button className="button primary" type="submit" disabled={saving}>{saving ? '保存中…' : '保存设置'}</button></div>
        </form>}
      </aside>}
    </div>
    {pendingIntent && <div className="dialog-backdrop"><section ref={discardDialog} className="discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description">
      <h2 id="discard-title">放弃未保存的更改？</h2><p id="discard-description">当前编辑还没有保存，离开后将丢弃这些更改。</p>
      <div><button className="button" autoFocus onClick={() => setPendingIntent(null)}>继续编辑</button>
        <button className="button primary" onClick={() => { const action = pendingIntent; setPendingIntent(null); action(); }}>放弃更改</button></div>
    </section></div>}
  </div>;
}
