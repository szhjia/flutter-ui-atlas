import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {join, resolve} from 'node:path';
import {createConfigStore} from './config-store.mjs';
import {createProjectAdapter} from './project-runtime.mjs';
import {createLiveSessionManager} from './live-sessions.mjs';
import {validateAtlasOutput, selectProfiles} from './project.mjs';
import {ConfigError} from './config-values.mjs';
import {capture} from '../capture/index.mjs';

export const isStandardProject = input => input.managed && !input.custom && Array.isArray(input.config.screens);
export const profileOutput = (output, profile) => (profile.name ? join(output, profile.name) : output);

export async function buildStandard(input, profiles, launchBrowser) {
  const store = await createConfigStore({configFile: join(input.directory, 'atlas.yaml')});
  const snapshot = await store.readBuildSnapshot();
  if (
    !isDeepStrictEqual({...snapshot.config, output: snapshot.config.output ?? 'generated'}, input.config) ||
    input.output !== resolve(snapshot.directory, snapshot.config.output ?? 'generated') ||
    input.publicPath !== (snapshot.config.publicPath ?? '/generated') ||
    profiles.some(profile => !selectProfiles(snapshot.config).some(current => isDeepStrictEqual(current, profile)))
  )
    throw Error('配置在读取期间发生变化，请重新运行命令');
  let failed = false;
  for (const profile of profiles) {
    try {
      await validateAtlasOutput(input.directory, profileOutput(input.output, profile));
      const result = await capture({
        output: profileOutput(input.output, profile),
        publicPath: input.publicPath,
        viewport: profile.viewport,
        requireObservedEdges: snapshot.config.requireObservedEdges,
        adapter: () => createProjectAdapter({snapshot, profile}),
        launchBrowser
      });
      const summary = {
        profile: profile.name,
        captureId: result.captureId,
        pages: result.screens.length,
        captured: result.screens.filter(s => s.status === 'captured').length,
        observedEdges: result.edges.filter(e => e.status === 'observed').length,
        failedEdges: result.edges.filter(e => e.status === 'failed').length,
        runtimeErrors: result.runtimeErrors.length
      };
      if (summary.pages !== summary.captured || summary.failedEdges || summary.runtimeErrors) failed = true;
      console.log(JSON.stringify(summary));
    } catch (error) {
      failed = true;
      console.error(`视口 ${profile.name ?? '默认'} 构建失败：${error.message}`);
    }
  }
  return failed ? 1 : 0;
}

export async function standardLiveSessions(input, profile, launchBrowser) {
  const store = await createConfigStore({configFile: join(input.directory, 'atlas.yaml')});
  const output = profileOutput(input.output, profile);
  await validateAtlasOutput(input.directory, output);
  return createLiveSessionManager({
    openSession: async ({screenId, captureId, signal}) => {
      const sessionKey = `${captureId}-${randomUUID()}`;
      let browser,
        session,
        recorded = false,
        closing;
      const close = () =>
        (closing ??= (async () => {
          await session?.close().catch(() => {});
          await browser?.close().catch(() => {});
          if (recorded) await store.writeSessionRecord(sessionKey, null);
        })());
      const aborted = () => {
        void close();
      };
      signal.addEventListener('abort', aborted, {once: true});
      try {
        const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
        if (
          manifest.captureId !== captureId ||
          !manifest.screens.some(s => s.id === screenId && s.status === 'captured')
        )
          throw Error('当前图谱已变化或页面不存在，请刷新画布');
        const record = await store.readBuildRecord(captureId);
        if (record.profileName !== profile.name || JSON.stringify(record.viewport) !== JSON.stringify(profile.viewport))
          throw Error('图谱视口与当前配置不一致，请重新构建');
        const snapshot = await store.readBuildSnapshot({captureId});
        const adapter = createProjectAdapter({snapshot, profile});
        const assertSource = async () => {
          if (((await adapter.sourceFingerprint?.()) ?? '') !== manifest.sourceFingerprint)
            throw new ConfigError('源码已变化，请重新构建', 409);
        };
        await assertSource();
        const screen = (await adapter.catalog()).screens.find(s => s.id === screenId);
        if (!screen) throw Error('当前账户已停用或页面不存在，请重新构建');
        if (signal.aborted) throw Error('实时会话已取消');
        browser = await launchBrowser();
        if (signal.aborted) {
          await browser.close();
          throw Error('实时会话已取消');
        }
        session = await adapter.open({browser, screen, viewport: profile.viewport});
        await session.ready(screen);
        await snapshot.assertCurrent();
        await assertSource();
        if (signal.aborted) throw Error('实时会话已取消');
        await store.writeSessionRecord(sessionKey, {
          screenId,
          captureId,
          viewport: profile.viewport,
          endpoint: browser.atlasEndpoint,
          pid: browser.atlasPid
        });
        recorded = true;
        if (signal.aborted) throw Error('实时会话已取消');
        return {
          page: session.page,
          close: async () => {
            signal.removeEventListener('abort', aborted);
            await close();
          }
        };
      } catch (error) {
        signal.removeEventListener('abort', aborted);
        // abort 期间启动的迟到资源同样必须回收。
        await session?.close().catch(() => {});
        await browser?.close().catch(() => {});
        if (recorded) await store.writeSessionRecord(sessionKey, null);
        throw new ConfigError(
          error.code === 'ENOENT'
            ? '尚无可用图谱，请先运行 atlas build'
            : error instanceof ConfigError ||
                /^(当前图谱|图谱视口|当前账户|实时会话|页面就绪|应用操作失败|应用不可达|配置或凭据)/.test(error.message)
              ? error.message
              : '实时会话准备失败，请检查应用、账户与页面判据',
          409
        );
      }
    }
  });
}
