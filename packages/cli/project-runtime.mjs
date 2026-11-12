import {expandCatalog} from './project-catalog.mjs';
import {createAuthenticationAdapter} from './config-auth.mjs';
import {executeSteps, matchesReady, waitReady} from './browser-actions.mjs';
import {sourceFingerprintForFiles} from '../capture/declarative.mjs';

/** 配置页、采集、实时会话复用认证与操作执行器；项目无需导入工具代码。 */
export function createProjectAdapter({snapshot, profile}) {
  const {config, project, roles, directory} = snapshot;
  const catalog = expandCatalog(config, roles);
  const options = {
    baseUrl: project.baseUrl,
    routeMode: config.routeMode ?? 'hash',
    timeoutMs: config.timeoutMs ?? 15000
  };
  const routeOf = page => {
    const url = new URL(page.url());
    return url.origin !== new URL(project.baseUrl).origin
      ? '应用来源已变化'
      : options.routeMode === 'hash'
        ? url.hash.slice(1).split('?')[0] || '/'
        : url.pathname;
  };
  const privatePasswords = roles.map(role => role.credentials?.password).filter(Boolean);
  const cleanError = error => {
    const message = error instanceof Error ? error.message : String(error);
    if (privatePasswords.some(password => message.includes(password))) return Error('应用操作失败，敏感诊断已隐藏');
    if (
      /配置或凭据已变化|^页面就绪|^操作地址|^操作离开|^操作目标|^操作只|^真实登录|^登录离开|^应用不可达|^应用操作失败/.test(
        message
      )
    )
      return Error(message);
    if (/net::ERR_CONNECTION|net::ERR_NAME/.test(message)) return Error('应用不可达，请先启动项目的 Web 服务');
    return Error('应用操作失败：请检查应用可达、登录凭据、定位器和正文判据');
  };
  const protect = async work => {
    try {
      return await work();
    } catch (error) {
      throw cleanError(error);
    }
  };
  const authenticate = async (page, role) => {
    const auth = await createAuthenticationAdapter({directory, project});
    await auth.login({page, role, credentials: role.credentials, baseUrl: project.baseUrl});
    const result = await auth.verify({page, role});
    if (!result?.authenticated || result.identityMatches === false) throw Error('真实登录未通过');
    if (new URL(page.url()).origin !== new URL(project.baseUrl).origin) throw Error('登录离开应用来源');
  };
  const content = screen => ({all: [{route: screen.route}, screen.ready]});
  return {
    catalog: async () => catalog,
    sourceFingerprint: sourceFingerprintForFiles(config.sourceFiles ?? [], directory),
    assertFresh: () => snapshot.assertCurrent(),
    commitPublication: work => snapshot.withCurrent(work),
    sanitizeError: error => {
      const message = error instanceof Error ? error.message : String(error);
      return privatePasswords.some(password => message.includes(password)) ? '应用操作失败，敏感诊断已隐藏' : message;
    },
    beforePublish: ({captureId}) =>
      snapshot.recordBuild({captureId, profileName: profile.name, viewport: profile.viewport}),
    async open({browser, screen, viewport = profile.viewport}) {
      const context = await browser.newContext({viewport});
      try {
        return await protect(async () => {
          const page = await context.newPage();
          page.setDefaultTimeout(options.timeoutMs);
          page.setDefaultNavigationTimeout(options.timeoutMs);
          const errors = [];
          page.on('pageerror', () => errors.push('应用发生运行错误'));
          page.on('console', message => {
            if (message.type() === 'error') errors.push('应用记录了运行错误');
          });
          // 所有顶层导航均约束为配置来源，避免把凭据送给重定向后的外部页面。
          await page.route('**/*', async route => {
            const request = route.request();
            if (
              request.isNavigationRequest() &&
              request.frame() === page.mainFrame() &&
              new URL(request.url()).origin !== new URL(project.baseUrl).origin
            )
              await route.abort();
            else await route.continue();
          });
          if (screen._role.id !== '@anonymous') await authenticate(page, screen._role);
          await page.goto(screen.entry, {waitUntil: 'domcontentloaded'});
          await executeSteps(page, screen.prepare, options);
          return {
            page,
            errors,
            close: () => context.close(),
            currentRoute: async () => routeOf(page),
            ready: target => protect(() => waitReady(page, content(target), {...options, entry: target.entry})),
            matchesState: target =>
              protect(() => matchesReady(page, content(target), {...options, entry: target.entry}))
          };
        });
      } catch (error) {
        await context.close();
        throw error;
      }
    },
    perform: (session, edge) =>
      protect(async () => {
        if (edge._from._role.id === '@anonymous' && edge._to._role.id !== '@anonymous')
          await authenticate(session.page, edge._to._role);
        await executeSteps(session.page, edge.steps ?? (edge.click ? [{click: edge.click}] : []), options);
      })
  };
}
