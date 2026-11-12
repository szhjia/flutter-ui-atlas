import type {Authentication, LocatorSpec} from './types';

const fieldLabels = {username: '账号字段', password: '密码字段', submit: '提交按钮', success: '成功判据', failure: '失败判据'};
const formDefaults: Authentication = {type: 'form', loginUrl: '/',
  username: {kind: 'label', name: ''}, password: {kind: 'label', name: ''},
  submit: {kind: 'role', role: 'button', name: ''}, success: {kind: 'text', name: ''}};

export function AuthenticationFields({value, disabled, onChange}: {
  value: Authentication; disabled: boolean; onChange(value: Authentication): void;
}) {
  return <section className="authentication-fields" aria-label="登录方式设置">
    <h3>登录方式</h3>
    <div className="field"><label htmlFor="auth-type">认证方式</label>
      <select id="auth-type" value={value.type} disabled={disabled} onChange={event => {
        onChange(event.target.value === 'form' ? structuredClone(formDefaults)
          : event.target.value === 'module' ? {type: 'module', module: ''} : {type: 'none'});
      }}><option value="none">尚未配置</option><option value="form">通用登录表单</option><option value="module">可信本地 MJS 模块</option></select></div>
    {value.type === 'module' && <div className="field"><label htmlFor="auth-module">本地认证模块</label>
      <input id="auth-module" value={value.module} disabled={disabled} placeholder="../tools/atlas-auth.mjs"
        onChange={event => onChange({...value, module: event.target.value})}/>
      <p className="privacy-note">仅填写你信任的本地代码路径，相对于 .atlas 目录。</p></div>}
    {value.type === 'form' && <>
      <div className="field"><label htmlFor="auth-url">登录地址</label><input id="auth-url" value={value.loginUrl}
        disabled={disabled} onChange={event => onChange({...value, loginUrl: event.target.value})}/></div>
      {(Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]).map(key => {
        const spec = value[key] ?? {kind: 'text', name: ''};
        function update(next: LocatorSpec) {
          onChange({...value, [key]: next});
        }
        return <div className="field locator-field" key={key}>
          <label htmlFor={`auth-${key}`}>{fieldLabels[key]}{key === 'failure' ? '（可选）' : ''}</label>
          <div className="locator-kind"><select aria-label={`${fieldLabels[key]}定位方式`} disabled={disabled} value={spec.kind}
            onChange={event => update({...spec, kind: event.target.value as LocatorSpec['kind'], role: spec.role ?? 'button'})}>
            <option value="label">字段标签</option><option value="role">角色与名称</option><option value="text">精确文字</option>
          </select>{spec.kind === 'role' && <input aria-label={`${fieldLabels[key]}语义角色`} value={spec.role ?? ''} disabled={disabled}
            onChange={event => update({...spec, role: event.target.value})}/>}</div>
          <input id={`auth-${key}`} value={spec.name} disabled={disabled} onChange={event => update({...spec, name: event.target.value})}/>
        </div>;
      })}
    </>}
  </section>;
}
