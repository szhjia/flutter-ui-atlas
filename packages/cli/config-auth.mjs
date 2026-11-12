import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ConfigError, digest, projectValue} from './config-values.mjs';
import {enableFlutterSemantics} from './flutter-semantics.mjs';
import {locator, unique, fillField} from './browser-actions.mjs';

export {launchManagedBrowser as launchAuthenticationBrowser} from './managed-browser.mjs';

async function retainsValue(target, value) {
  return target.evaluate((element, expected) => {
    const actual = 'value' in element ? element.value : element.textContent;
    return actual === expected;
  }, value);
}
function formAdapter(auth) {
  return {
    version: digest(auth),
    async login({page, credentials, baseUrl}) {
      await page.goto(auth.loginUrl, {waitUntil: 'domcontentloaded'});
      // Flutter 启动可能在 DOMContentLoaded 之后；同时等字段或无障碍入口。
      await locator(page, auth.username)
        .or(page.locator('flt-semantics-placeholder'))
        .first()
        .waitFor({state: 'attached'});
      await enableFlutterSemantics(page);
      if (new URL(page.url()).origin !== new URL(baseUrl).origin)
        throw new ConfigError('登录页已离开应用来源，请使用受信任的认证适配器。');
      if (await locator(page, auth.success).first().isVisible())
        throw new ConfigError('登录前成功判据已成立，请选择能区分登录状态的判据。');
      const username = await fillField(page, auth.username, credentials.username);
      const password = await fillField(page, auth.password, credentials.password);
      if (
        !(await retainsValue(username, credentials.username)) ||
        !(await retainsValue(password, credentials.password))
      ) {
        throw new ConfigError('登录字段未保留输入，请检查页面就绪或使用本地认证模块。');
      }
      await (await unique(page, auth.submit)).click();
    },
    async verify({page}) {
      const success = locator(page, auth.success);
      if (auth.failure) {
        const failure = locator(page, auth.failure);
        await success.or(failure).first().waitFor({state: 'visible'});
        if (await failure.first().isVisible()) return {authenticated: false};
      } else await success.first().waitFor({state: 'visible'});
      if ((await success.count()) !== 1) throw new ConfigError('成功判据不唯一，请修正登录设置。');
      return {authenticated: await success.isVisible()};
    }
  };
}

export async function createAuthenticationAdapter({directory, project}) {
  const auth = projectValue(project).authentication;
  if (auth.type === 'none') throw new ConfigError('请先配置登录方式。');
  let adapter;
  if (auth.type === 'form') adapter = formAdapter(auth);
  else {
    const file = resolve(directory, auth.module);
    const source = await readFile(file, 'utf8');
    if (digest(source) !== project.authenticationRevision)
      throw new ConfigError('认证模块已更改，请重新加载配置后测试。', 409);
    adapter = (await import(`${pathToFileURL(file).href}?atlas=${digest(source)}`)).default;
    if (
      !adapter ||
      typeof adapter.version !== 'string' ||
      !adapter.version.trim() ||
      typeof adapter.login !== 'function' ||
      typeof adapter.verify !== 'function'
    ) {
      throw new ConfigError('认证模块必须提供 version、login 和 verify。');
    }
  }
  return adapter;
}

/** 管理本服务创建的浏览器，关闭服务时中止全部登录上下文。 */
export function createAuthenticationRunner({directory, launchBrowser, timeoutMs = 15_000}) {
  const browsers = new Set();
  let closed = false;
  return {
    async test(attempt) {
      let browser;
      let timer;
      let cancelled = false;
      const execute = async () => {
        const {project, credentials, role} = attempt;
        const auth = projectValue(project).authentication;
        if (auth.type === 'none') throw new ConfigError('请先在应用设置中配置登录方式。');
        if (!credentials.username || !credentials.password) throw new ConfigError('请先填写登录账号和密码。');
        const adapter = await createAuthenticationAdapter({directory, project});
        if (closed) throw new ConfigError('配置服务已关闭。');
        browser = await launchBrowser();
        if (cancelled || closed) {
          await browser.close().catch(() => {});
          throw new ConfigError('登录测试已取消。');
        }
        browsers.add(browser);
        if (closed) throw new ConfigError('配置服务已关闭。');
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(timeoutMs);
        await adapter.login({page, credentials, role, baseUrl: project.baseUrl});
        const evidence = await adapter.verify({page, role});
        if (auth.type === 'form' && new URL(page.url()).origin !== new URL(project.baseUrl).origin) {
          return {status: 'failed', message: '登录离开应用来源，未确认登录成功。'};
        }
        if (evidence?.identityMatches === false)
          return {status: 'failed', message: '实际身份与配置角色不符，请检查账号或身份判据。'};
        return evidence?.authenticated === true
          ? {status: 'passed', message: '真实登录测试通过；此结果不代表已验证全部角色权限。'}
          : {status: 'failed', message: '登录未通过，请检查账号、密码及登录判据。'};
      };
      try {
        return await Promise.race([
          execute(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new ConfigError('登录测试超时，请检查应用是否可达及登录判据。')),
              timeoutMs
            );
          })
        ]);
      } catch (error) {
        // Playwright/MJS 的异常可能含输入值、页面文字和 URL，不向日志或浏览器透传。
        return {
          status: 'failed',
          message:
            error instanceof ConfigError
              ? error.message
              : '无法完成登录测试，请确认应用可达、认证模块有效且登录字段与判据唯一。'
        };
      } finally {
        cancelled = true;
        clearTimeout(timer);
        if (browser) {
          await browser.close().catch(() => {});
          browsers.delete(browser);
        }
      }
    },
    async close() {
      closed = true;
      await Promise.allSettled([...browsers].map(browser => browser.close()));
      browsers.clear();
    }
  };
}
