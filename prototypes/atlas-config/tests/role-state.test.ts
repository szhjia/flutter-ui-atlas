import {describe, expect, test} from 'vitest';
import {createDemoAdapter} from '../src/demo-adapter';
import {createDraft} from '../src/model';

describe.each([
  {tag: 'reviewer', enabled: true, label: '启用'},
  {tag: 'admin', enabled: false, label: '停用'},
])('列表$label后保存角色', ({tag, enabled}) => {
  test('已经打开的表单不会覆盖列表的新状态', async () => {
    const adapter = createDemoAdapter();
    const role = (await adapter.load()).roles.find(item => item.tag === tag)!;
    const draft = {...createDraft(role), name: `${role.name}已编辑`};
    await adapter.setEnabled(role.id, enabled);
    const saved = await adapter.saveRole(draft);
    expect(saved).toMatchObject({enabled, name: draft.name});
    expect((await adapter.load()).roles.find(item => item.id === role.id))
      .toMatchObject({enabled, name: draft.name});
  });

  test.each(['先切换再保存', '先保存再切换'])('%s，两项更改都保留', async order => {
    const adapter = createDemoAdapter();
    const role = (await adapter.load()).roles.find(item => item.tag === tag)!;
    const draft = {...createDraft(role), name: `${role.name}并发编辑`};
    const operations = order === '先切换再保存'
      ? [adapter.setEnabled(role.id, enabled), adapter.saveRole(draft)]
      : [adapter.saveRole(draft), adapter.setEnabled(role.id, enabled)];
    await Promise.all(operations);
    expect((await adapter.load()).roles.find(item => item.id === role.id))
      .toMatchObject({enabled, name: draft.name});
  });
});

test('新增角色默认启用，之后可以仅通过列表停用', async () => {
  const adapter = createDemoAdapter();
  const saved = await adapter.saveRole({
    ...createDraft(), tag: 'reader', name: '只读用户', username: 'reader@example.test', password: 'atlas-demo',
  });
  expect(saved.enabled).toBe(true);
  await adapter.setEnabled(saved.id, false);
  expect((await adapter.load()).roles.find(item => item.id === saved.id)?.enabled).toBe(false);
});

describe('保存登录测试结果', () => {
  test.each(['已有角色', '新增角色'])('%s保存相同凭据时保留最近的失败结果', async kind => {
    const adapter = createDemoAdapter();
    const member = (await adapter.load()).roles.find(role => role.tag === 'member')!;
    const draft = kind === '已有角色' ? createDraft(member) : {
      ...createDraft(), tag: 'reader', name: '只读用户', username: 'reader@example.test',
    };
    expect((await adapter.testLogin({...draft, password: 'atlas-demo'})).status).toBe('passed');
    const failedDraft = {...draft, password: 'wrong'};
    expect((await adapter.testLogin(failedDraft)).status).toBe('failed');

    const saved = await adapter.saveRole(failedDraft);

    expect(saved.testStatus).toBe('failed');
    expect((await adapter.load()).roles.find(role => role.id === saved.id)?.testStatus).toBe('failed');
  });

  test('保存相同凭据时保留通过结果', async () => {
    const adapter = createDemoAdapter();
    const member = (await adapter.load()).roles.find(role => role.tag === 'member')!;
    const draft = {...createDraft(member), password: 'atlas-demo'};
    expect((await adapter.testLogin(draft)).status).toBe('passed');

    expect((await adapter.saveRole(draft)).testStatus).toBe('passed');
  });

  test('留空复用已保存密码时也保留失败结果', async () => {
    const adapter = createDemoAdapter();
    const member = (await adapter.load()).roles.find(role => role.tag === 'member')!;
    const saved = await adapter.saveRole({...createDraft(member), password: 'wrong'});
    const draft = createDraft(saved);
    expect((await adapter.testLogin(draft)).status).toBe('failed');

    expect((await adapter.saveRole(draft)).testStatus).toBe('failed');
  });

  test.each([
    {label: '密码', changes: {password: 'another-wrong'}},
    {label: '账号', changes: {username: 'another@example.test'}},
  ])('更换$label后不沿用旧凭据的失败结果', async ({changes}) => {
    const adapter = createDemoAdapter();
    const member = (await adapter.load()).roles.find(role => role.tag === 'member')!;
    const draft = {...createDraft(member), password: 'wrong'};
    await adapter.testLogin(draft);

    expect((await adapter.saveRole({...draft, ...changes})).testStatus).toBe('untested');
  });

  test('清除密码后显示待配置而非旧的失败结果', async () => {
    const adapter = createDemoAdapter();
    const member = (await adapter.load()).roles.find(role => role.tag === 'member')!;
    const draft = {...createDraft(member), password: 'wrong'};
    await adapter.testLogin(draft);

    expect((await adapter.saveRole({...draft, clearPassword: true})).testStatus).toBe('unconfigured');
  });

  test('更换应用地址后使已保存及缓存的失败结果失效', async () => {
    const adapter = createDemoAdapter();
    const {roles, project} = await adapter.load();
    const member = roles.find(role => role.tag === 'member')!;
    const draft = {...createDraft(member), password: 'wrong'};
    await adapter.testLogin(draft);
    await adapter.saveRole(draft);

    await adapter.saveProject({...project, baseUrl: 'https://another.example.test'});

    expect((await adapter.load()).roles.find(role => role.id === member.id)?.testStatus).toBe('untested');
    expect((await adapter.saveRole(draft)).testStatus).toBe('untested');
  });
});
