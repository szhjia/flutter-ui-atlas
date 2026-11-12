import {expect, test, type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createAuthenticationRunner, launchAuthenticationBrowser} from '../../packages/cli/config-auth.mjs';
import {serveConfig} from '../../packages/cli/config-server.mjs';
import {configFixture, configure, draft, loginApplication} from '../helpers/config-fixtures.mjs';

async function setup() {
  const fixture = await configFixture(); const application = await loginApplication();
  const authentication = createAuthenticationRunner({directory: fixture.directory,
    launchBrowser: () => launchAuthenticationBrowser({channel: 'chrome'})});
  const service = await serveConfig({store: fixture.store, authentication});
  let stopped = false;
  return {...fixture, application, service,
    async stop() { if (!stopped) { stopped = true; await service.close(); } },
    async close() { if (!stopped) await service.close(); await application.close(); await fixture.cleanup(); }};
}
async function newRole(page: Page, password = 'example-password') {
  await page.locator('.section-heading').getByRole('button', {name: '新增角色', exact: true}).click();
  await page.getByRole('textbox', {name: 'Tag', exact: true}).fill('reader');
  await page.getByRole('textbox', {name: '显示名称', exact: true}).fill('只读用户');
  await page.getByRole('textbox', {name: '登录账号', exact: true}).fill('reader@example.test');
  await page.getByLabel('登录密码', {exact: true}).fill(password);
}
const row = (page: Page) => page.getByRole('row').filter({has: page.getByRole('button', {name: '编辑只读用户', exact: true})});

test('延迟的默认聚焦不会打断用户已开始编辑的字段', async ({page}) => {
  const value = await setup();
  try {
    await page.goto(value.service.url);
    await expect(page.getByText('先添加一个采集角色', {exact: true})).toBeVisible();
    await page.evaluate(() => {
      const frames: FrameRequestCallback[] = [];
      const original = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
      (window as unknown as {flushFocusFrame(): void}).flushFocusFrame = () => {
        window.requestAnimationFrame = original;
        frames.forEach(callback => callback(performance.now()));
      };
    });
    await page.locator('.section-heading').getByRole('button', {name: '新增角色', exact: true}).click();
    const name = page.getByLabel('显示名称', {exact: true});
    await name.focus();
    await page.evaluate(() => (window as unknown as {flushFocusFrame(): void}).flushFocusFrame());
    await expect(name).toBeFocused();
    await name.fill('正在输入的名称');
    await expect(name).toHaveValue('正在输入的名称');
    await expect(page.getByLabel('Tag', {exact: true})).toHaveValue('');
  } finally { await value.close(); }
});

test('正式页面配置通用登录，失败保存后重载仍显示未通过', async ({page}) => {
  const value = await setup();
  try {
    await page.goto(value.service.url);
    await page.getByRole('button', {name: '应用设置', exact: true}).click();
    await page.getByLabel('应用名称', {exact: true}).fill('独立登录示例');
    await page.getByLabel('Flutter Web 地址', {exact: true}).fill(value.application.url);
    await page.getByLabel('认证方式', {exact: true}).selectOption('form');
    await page.getByLabel('登录地址', {exact: true}).fill(value.application.url);
    await page.getByLabel('账号字段', {exact: true}).fill('登录账号');
    await page.getByLabel('密码字段', {exact: true}).fill('登录密码');
    await page.getByLabel('提交按钮', {exact: true}).fill('登录');
    await page.getByLabel('成功判据', {exact: true}).fill('登录成功');
    await page.getByLabel('失败判据（可选）', {exact: true}).fill('账号或密码错误');
    await page.getByRole('button', {name: '保存设置', exact: true}).click();
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await newRole(page, 'wrong');
    await page.getByRole('button', {name: '测试登录', exact: true}).click();
    await expect(page.getByText('测试未通过', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '保存角色', exact: true}).click();
    await expect(row(page).getByText('未通过', {exact: true})).toBeVisible();
    await page.reload();
    await expect(row(page).getByText('未通过', {exact: true})).toBeVisible();
    await expect(page.getByLabel('登录密码', {exact: true})).toHaveValue('');
  } finally { await value.close(); }
});

test('已有密码留空复用、成功重测、列表停用、删除及桌面布局', async ({page}) => {
  const value = await setup();
  try {
    await configure(value.store, value.application.url);
    await value.store.saveRole(draft());
    await page.goto(value.service.url);
    await page.getByRole('button', {name: '测试登录', exact: true}).click();
    await expect(page.getByText('测试通过', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '保存角色', exact: true}).click();
    await expect(row(page).getByText('已通过', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '编辑只读用户', exact: true}).click();
    await page.getByRole('switch', {name: '只读用户自动采集'}).click();
    await expect(page.getByRole('switch', {name: '只读用户自动采集'})).not.toBeChecked();
    await page.getByLabel('显示名称', {exact: true}).fill('只读用户已编辑');
    await page.getByRole('button', {name: '保存角色', exact: true}).click();
    await expect(page.getByRole('switch', {name: '只读用户已编辑自动采集'})).not.toBeChecked();
    await page.getByRole('button', {name: '编辑只读用户已编辑', exact: true}).click();
    for (const [width, height] of [[1487, 1058], [1280, 900], [1024, 768]]) {
      await page.setViewportSize({width, height});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const button = await page.getByRole('button', {name: '保存角色', exact: true}).boundingBox();
      expect(button!.y + button!.height).toBeLessThanOrEqual(height);
    }
    await page.getByRole('button', {name: '删除角色', exact: true}).click();
    await page.getByRole('button', {name: '取消删除', exact: true}).click();
    await page.getByRole('button', {name: '删除角色', exact: true}).click();
    await page.getByRole('button', {name: '确认删除', exact: true}).click();
    await expect(page.getByText('先添加一个采集角色', {exact: true})).toBeVisible();
    expect((await value.store.load()).roles).toHaveLength(0);
  } finally { await value.close(); }
});

test('并发编辑冲突保留草稿，断开服务后禁用写入', async ({page}) => {
  const value = await setup();
  try {
    const initial = await value.store.saveRole(draft());
    await page.goto(value.service.url);
    await page.getByLabel('显示名称', {exact: true}).fill('未提交草稿');
    await value.store.saveRole({...draft(), id: initial.id, revision: initial.revision, name: '另一个编辑者'});
    await page.getByRole('button', {name: '保存角色', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('其他编辑修改');
    await expect(page.getByLabel('显示名称', {exact: true})).toHaveValue('未提交草稿');
    await value.stop();
    await expect(page.getByRole('button', {name: '保存角色', exact: true})).toBeDisabled({timeout: 6000});
    await expect(page.getByLabel('显示名称', {exact: true})).toHaveValue('未提交草稿');
  } finally { await value.close(); }
});

test('通用认证隔离每次上下文，目标不唯一及不可达均失败', async () => {
  const value = await setup();
  try {
    await configure(value.store, value.application.url);
    const run = async (input: ReturnType<typeof draft>) => {
      const response = await fetch(value.service.origin + '/api/test-login', {method: 'POST',
        headers: {'X-Atlas-Token': value.service.token, Origin: value.service.origin, 'Content-Type': 'application/json'}, body: JSON.stringify(input)});
      return response.json();
    };
    expect((await run(draft())).status).toBe('passed');
    expect((await run(draft({password: 'wrong'}))).status).toBe('failed');
    const project = (await value.store.load()).project;
    await value.store.saveProject({...project, authentication: {...project.authentication, loginUrl: value.application.url + '?duplicate'}});
    expect((await run(draft())).status).toBe('failed');
    await configure(value.store, 'http://127.0.0.1:1/');
    expect((await run(draft())).status).toBe('failed');
  } finally { await value.close(); }
});

test('Flutter 语义字段在焦点后的渲染更新才订阅输入时仍可登录', async () => {
  const value = await setup();
  try {
    await configure(value.store, value.application.url);
    const project = (await value.store.load()).project;
    await value.store.saveProject({...project, authentication: {...project.authentication, loginUrl: value.application.url + '?deferred'}});
    const response = await fetch(value.service.origin + '/api/test-login', {method: 'POST',
      headers: {'X-Atlas-Token': value.service.token, Origin: value.service.origin, 'Content-Type': 'application/json'},
      body: JSON.stringify(draft())});
    const result = await response.json();
    expect(result.status, result.message).toBe('passed');
  } finally { await value.close(); }
});

test('可信 MJS 需要当前身份判据，异常不能泄露密码', async () => {
  const value = await setup();
  try {
    const module = join(value.directory, 'auth.mjs');
    await writeFile(module, 'export default {version:"1", async login(){}, async verify(){return {authenticated:true,identityMatches:false}}}');
    await value.store.saveProject({...((await value.store.load()).project), authentication: {type: 'module', module: './auth.mjs'}});
    const attempt = await value.store.prepareLogin(draft());
    const runner = createAuthenticationRunner({directory: value.directory, launchBrowser: () => launchAuthenticationBrowser({channel: 'chrome'})});
    try {
      const result = await runner.test(attempt);
      expect(result.status).toBe('failed'); expect(result.message).toContain('身份');
      await writeFile(module, 'export default {version:"2", async login({credentials}){throw Error(credentials.password)}, async verify(){return {authenticated:true}}}');
      const failed = await runner.test(await value.store.prepareLogin(draft()));
      expect(failed.status).toBe('failed'); expect(failed.message).not.toContain('example-password');
    } finally { await runner.close(); }
  } finally { await value.close(); }
});

for (const status of ['passed', 'failed'] as const) {
  test(`${status} 登录结果在暂时保存失败后重试仍保留`, async ({page}) => {
    const value = await setup();
    try {
      await configure(value.store, value.application.url);
      const input = draft();
      const oldStatus = status === 'passed' ? 'failed' : 'passed';
      const old = value.store.recordLogin(await value.store.prepareLogin(input), {status: oldStatus, message: '先前结果'});
      await value.store.saveRole({...input, checkId: old.checkId});
      // 使用正式存储与 HTTP 服务，只控制被测应用的认证响应及一次网络失败。
      if (status === 'failed') await value.application.close();
      await page.goto(value.service.url);
      await page.getByRole('button', {name: '测试登录', exact: true}).click();
      const label = status === 'passed' ? '测试通过' : '测试未通过';
      await expect(page.getByText(label, {exact: true})).toBeVisible();
      let first = true;
      const identifiers: (string | undefined)[] = [];
      await page.route('**/api/role', async route => {
        identifiers.push(route.request().postDataJSON().checkId);
        if (first) { first = false; await route.fulfill({status: 503, contentType: 'application/json', body: '{"message":"暂时写入失败，请重试。"}'}); }
        else await route.continue();
      });
      await page.getByRole('button', {name: '保存角色', exact: true}).click();
      await expect(page.getByRole('alert').filter({hasText: '暂时写入失败'})).toBeVisible();
      await expect(page.getByText(label, {exact: true})).toBeVisible();
      await page.getByRole('button', {name: '保存角色', exact: true}).click();
      await expect(page.getByRole('complementary')).toHaveCount(0);
      expect(identifiers[0]).toBeTruthy();
      expect(identifiers[1]).toBe(identifiers[0]);
      expect((await value.store.load()).roles[0].testStatus).toBe(status);
    } finally { await value.close(); }
  });
}
