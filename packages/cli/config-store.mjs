import {chmod, lstat, mkdir, readFile, realpath, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {parse, parseDocument, Document, isMap, isSeq} from 'yaml';
import {findFlutterProject, resolveProjectConfig} from './project.mjs';
import {acquireOutputLock} from '../capture/lock.mjs';
import {ConfigError, conflict, digest, object, projectValue, roleValue} from './config-values.mjs';
import {ensureAtlasIgnored} from './project-ignore.mjs';

const run = promisify(execFile);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function optional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** 所有磁盘访问均经同一项目锁；凭据永不由公开快照返回。 */
export async function createConfigStore({cwd = process.cwd(), configFile} = {}) {
  const root = await findFlutterProject(configFile ? dirname(resolve(cwd, configFile)) : cwd);
  const directory = join(root, '.atlas');
  const yaml = join(directory, 'atlas.yaml');
  if (configFile && resolve(cwd, configFile) !== yaml)
    throw new ConfigError('配置页仅编辑 .atlas/atlas.yaml，请先迁入官方 YAML；原配置不会改写。');
  const local = join(directory, 'local');
  const credentials = join(local, 'credentials.json');
  const journal = join(local, 'transaction.json');
  let queue = Promise.resolve();

  async function safe(path, isDirectory = false) {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || (isDirectory ? !info.isDirectory() : !info.isFile())) {
        throw new ConfigError('配置路径必须是工程内的实际目录或文件，不能使用符号链接。');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  async function tracked() {
    let gitRoot;
    try {
      gitRoot = (await run('git', ['-C', root, 'rev-parse', '--show-toplevel'])).stdout.trim();
    } catch (error) {
      if (error.code === 128) return;
      throw new ConfigError('无法检查 Git 跟踪状态，请确认 Git 可用后重试。');
    }
    const files = (await run('git', ['-C', gitRoot, 'ls-files', '-z', '--', relative(gitRoot, local)])).stdout;
    if (files) throw new ConfigError('本机凭据目录已有文件被 Git 跟踪，请先取消跟踪后重试。');
  }
  async function ensure() {
    await ensureAtlasIgnored(root);
    await safe(directory, true);
    await safe(local, true);
    await tracked();
    await mkdir(directory, {recursive: true});
    await mkdir(local, {recursive: true, mode: 0o700});
    await chmod(local, 0o700);
    for (const path of [yaml, credentials, journal, join(directory, '.gitignore')]) await safe(path);
    for (const path of [join(local, '.atlas-lock'), join(local, '.atlas-lock-guard')]) await safe(path, true);
    if ((await optional(credentials)) !== null) await chmod(credentials, 0o600);
  }
  async function atomic(file, value, mode) {
    await safe(file);
    const temporary = join(dirname(file), `.config-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, value, {flag: 'wx', mode});
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  async function restore(file, value, mode) {
    if (value === null)
      await unlink(file).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    else await atomic(file, value, mode);
  }
  async function recover() {
    const contents = await optional(journal);
    if (contents === null) return;
    let pending;
    try {
      pending = JSON.parse(contents);
    } catch {
      throw new ConfigError('配置事务记录损坏，已停止写入，请备份本机目录后恢复。', 500);
    }
    if (
      pending.version !== 1 ||
      !['prepared', 'committed'].includes(pending.state) ||
      ![pending.yaml, pending.credentials].every(value => value === null || typeof value === 'string')
    ) {
      throw new ConfigError('配置事务记录无效，已停止写入。', 500);
    }
    if (pending.state === 'prepared') {
      await restore(credentials, pending.credentials, 0o600);
      await restore(yaml, pending.yaml, 0o644);
    }
    await unlink(journal);
  }
  function serialize(action) {
    const next = queue.then(async () => {
      await ensure();
      let release;
      try {
        release = await acquireOutputLock(local, {warn: () => {}});
      } catch {
        throw new ConfigError('配置正被另一个任务写入，请稍后重试；异常退出的锁请按工程恢复说明处理。', 409);
      }
      try {
        await recover();
        return await action();
      } finally {
        await release();
      }
    });
    queue = next.catch(() => {});
    return next;
  }
  async function read() {
    await safe(yaml);
    await safe(credentials);
    const raw = await optional(yaml);
    let doc;
    try {
      doc = raw === null ? new Document({output: 'generated', port: 60200}) : parseDocument(raw);
    } catch {
      throw new ConfigError('YAML 配置损坏，请修正后重试。');
    }
    if (doc.errors.length || !object(doc.toJS())) throw new ConfigError('YAML 配置无效，必须是对象且没有重复字段。');
    const config = doc.toJS();
    if (raw === null) {
      const selected = await resolveProjectConfig({cwd: root});
      if (!selected.implicit)
        throw new ConfigError(
          '发现旧 JSON/MJS 配置，请先迁入 .atlas/atlas.yaml；MJS 可用 atlas init --adapter-config 接入。原文件未改写。'
        );
    }
    let secrets = {version: 1, roles: {}};
    const privateRaw = await optional(credentials);
    if (privateRaw !== null) {
      try {
        secrets = JSON.parse(privateRaw);
      } catch {
        throw new ConfigError('本机凭据文件损坏，已停止读取和写入。');
      }
      if (secrets.version !== 1 || !object(secrets.roles)) throw new ConfigError('不支持的本机凭据格式。');
    }
    const roles = config.roles ?? [];
    if (
      !Array.isArray(roles) ||
      roles.some(
        role =>
          !object(role) ||
          !uuid.test(role.id) ||
          typeof role.tag !== 'string' ||
          !/^[a-z][a-z0-9_-]{0,47}$/.test(role.tag) ||
          typeof role.name !== 'string' ||
          !role.name.trim() ||
          role.name.length > 64 ||
          typeof role.enabled !== 'boolean'
      ) ||
      new Set(roles.map(role => role.id)).size !== roles.length ||
      new Set(roles.map(role => role.tag)).size !== roles.length
    ) {
      throw new ConfigError('角色配置无效或 ID/Tag 重复，请先修正 YAML。');
    }
    for (const value of Object.values(secrets.roles)) {
      if (!object(value) || typeof value.username !== 'string' || typeof value.password !== 'string')
        throw new ConfigError('本机凭据记录无效。');
    }
    const pubspec = parse(await readFile(join(root, 'pubspec.yaml'), 'utf8'));
    const project = {
      name: config.title === undefined ? (pubspec.name ?? 'Flutter 应用') : config.title,
      baseUrl: config.baseUrl === undefined ? 'http://127.0.0.1:8080/' : config.baseUrl,
      authentication: config.authentication === undefined ? {type: 'none'} : config.authentication,
      allowRemoteUrls: config.allowRemoteUrls === undefined ? false : config.allowRemoteUrls
    };
    projectValue(project);
    if (raw === null) {
      doc.set('title', project.name);
      doc.set('baseUrl', project.baseUrl);
      doc.set('readyText', '');
      doc.set('authentication', project.authentication);
      doc.set('allowRemoteUrls', project.allowRemoteUrls);
    }
    if (project.authentication.type === 'module') {
      try {
        project.authenticationRevision = digest(
          await readFile(resolve(directory, project.authentication.module), 'utf8')
        );
      } catch {
        project.authenticationRevision = 'unavailable';
      }
    }
    project.revision = digest(project);
    return {doc, config, roles, secrets, project, raw, privateRaw};
  }
  function roleRevision(role, secret) {
    return digest([role.id, role.tag, role.name, secret?.username ?? '', secret?.password ?? '', secret?.nonce ?? '']);
  }
  function fingerprint(project, draft, password) {
    return digest([
      project.baseUrl,
      project.authentication,
      project.authenticationRevision,
      project.allowRemoteUrls,
      draft.tag,
      draft.username,
      password
    ]);
  }
  function publicRole(state, role) {
    const secret = state.secrets.roles[role.id];
    const configured = state.project.authentication.type !== 'none' && Boolean(secret?.password);
    const valid =
      secret &&
      secret.test?.fingerprint === fingerprint(state.project, {...role, username: secret.username}, secret.password);
    return {
      id: role.id,
      tag: role.tag,
      name: role.name,
      enabled: role.enabled,
      username: secret?.username ?? '',
      passwordSet: Boolean(secret?.password),
      testStatus: !configured ? 'unconfigured' : valid ? secret.test.status : 'untested',
      revision: roleRevision(role, secret)
    };
  }
  function updateAuthentication(doc, value) {
    if (!isMap(doc.get('authentication', true))) doc.set('authentication', doc.createNode({}));
    const managed = ['type', 'module', 'loginUrl', 'username', 'password', 'submit', 'success', 'failure'];
    for (const key of managed) {
      const path = ['authentication', key];
      if (!(key in value)) {
        doc.deleteIn(path);
        continue;
      }
      if (!object(value[key])) {
        doc.setIn(path, value[key]);
        continue;
      }
      if (!isMap(doc.getIn(path, true))) doc.setIn(path, doc.createNode({}));
      for (const field of ['kind', 'name', 'role']) {
        if (field in value[key]) doc.setIn([...path, field], value[key][field]);
        else doc.deleteIn([...path, field]);
      }
    }
  }
  function updateRoles(state) {
    if (!isSeq(state.doc.get('roles', true))) state.doc.set('roles', state.doc.createNode([]));
    const sequence = state.doc.get('roles', true);
    const previous = new Map(sequence.items.filter(isMap).map(node => [node.get('id'), node]));
    sequence.items = state.roles.map(role => {
      const node = previous.get(role.id) ?? state.doc.createNode(role);
      for (const key of ['id', 'tag', 'name', 'enabled']) node.set(key, role[key]);
      return node;
    });
  }
  async function commit(state) {
    const ignoredFile = join(directory, '.gitignore');
    const ignored = (await optional(ignoredFile)) ?? '';
    const lines = ignored.trimEnd().split(/\r?\n/);
    const additions = [
      ...(lines.includes('/generated/') ? [] : ['/generated/']),
      ...(lines.at(-1) === '/local/' ? [] : ['/local/'])
    ];
    if (additions.length)
      await atomic(
        ignoredFile,
        `${ignored}${ignored && !ignored.endsWith('\n') ? '\n' : ''}${additions.join('\n')}\n`,
        0o644
      );
    const pending = {version: 1, state: 'prepared', yaml: state.raw, credentials: state.privateRaw};
    await atomic(journal, JSON.stringify(pending), 0o600);
    try {
      await atomic(credentials, JSON.stringify(state.secrets, null, 2) + '\n', 0o600);
      updateRoles(state);
      await atomic(yaml, String(state.doc), 0o644);
      await atomic(journal, JSON.stringify({...pending, state: 'committed'}), 0o600);
    } catch (error) {
      await recover();
      throw error;
    }
    // 提交标记已持久化；清理失败不能把成功提交报告为失败，下次访问会清理。
    await unlink(journal).catch(() => {});
  }
  function existing(state, id, revision) {
    const role = state.roles.find(item => item.id === id);
    if (!role) throw new ConfigError('角色已不存在，请重新加载。', 404);
    if (revision !== undefined && revision !== roleRevision(role, state.secrets.roles[id])) throw conflict();
    return role;
  }
  function draftFor(state, input) {
    const draft = roleValue(input);
    const previous = draft.id ? existing(state, draft.id, draft.revision) : undefined;
    if (previous && typeof draft.revision !== 'string') throw conflict();
    if (state.roles.some(role => role.id !== draft.id && role.tag === draft.tag))
      throw new ConfigError('这个 Tag 已被使用，请换一个。');
    const password = draft.clearPassword ? '' : draft.password || state.secrets.roles[draft.id]?.password || '';
    return {draft, previous, password, fingerprint: fingerprint(state.project, draft, password)};
  }

  const checks = new Map();
  const stateVersion = state => digest([state.raw, state.privateRaw, state.project.authenticationRevision]);
  await serialize(async () => {
    await read();
  });
  return {
    directory,
    readBuildSnapshot: ({captureId} = {}) =>
      serialize(async () => {
        const state = await read();
        const version = stateVersion(state);
        if (captureId !== undefined) {
          if (!/^[0-9TZ-]+$/.test(captureId)) throw new ConfigError('采集标识无效');
          const builds = join(local, 'builds');
          await safe(builds, true);
          const file = join(builds, captureId + '.json');
          await safe(file);
          const raw = await optional(file);
          if (!raw) throw new ConfigError('当前图谱没有可用的本机配置快照，请重新构建。', 409);
          let record;
          try {
            record = JSON.parse(raw);
          } catch {
            throw new ConfigError('本机构建记录损坏，请重新构建。', 409);
          }
          if (record.captureId !== captureId || record.version !== version)
            throw new ConfigError('配置或凭据已变化，请重新构建。', 409);
        }
        const assertVersion = async () => {
          if (stateVersion(await read()) !== version) throw new ConfigError('配置或凭据已变化，请重新构建。', 409);
        };
        return {
          root,
          directory,
          version,
          config: structuredClone(state.doc.toJS()),
          project: structuredClone(state.project),
          roles: state.roles.map(role => ({
            ...structuredClone(role),
            credentials: {
              username: state.secrets.roles[role.id]?.username ?? '',
              password: state.secrets.roles[role.id]?.password ?? ''
            }
          })),
          assertCurrent: () => serialize(assertVersion),
          withCurrent: work =>
            serialize(async () => {
              await assertVersion();
              return work(assertVersion);
            }),
          recordBuild: ({captureId, profileName, viewport}) =>
            serialize(async () => {
              await assertVersion();
              if (!/^[0-9TZ-]+$/.test(captureId)) throw new ConfigError('采集标识无效');
              const builds = join(local, 'builds');
              await safe(builds, true);
              await mkdir(builds, {recursive: true, mode: 0o700});
              await chmod(builds, 0o700);
              const file = join(builds, captureId + '.json');
              await atomic(file, JSON.stringify({version, captureId, profileName, viewport}), 0o600);
            })
        };
      }),
    writeSessionRecord: (sessionKey, value) =>
      serialize(async () => {
        if (!/^[0-9TZ-]+-[a-f0-9-]{36}$/.test(sessionKey)) throw new ConfigError('采集标识无效');
        const sessions = join(local, 'sessions');
        await safe(sessions, true);
        await mkdir(sessions, {recursive: true, mode: 0o700});
        await chmod(sessions, 0o700);
        const file = join(sessions, sessionKey + '.json');
        await safe(file);
        if (value === null)
          await unlink(file).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
        else await atomic(file, JSON.stringify(value), 0o600);
      }),
    readBuildRecord: captureId =>
      serialize(async () => {
        if (!/^[0-9TZ-]+$/.test(captureId)) throw new ConfigError('采集标识无效');
        await safe(join(local, 'builds'), true);
        const file = join(local, 'builds', captureId + '.json');
        await safe(file);
        const raw = await optional(file);
        if (raw === null) throw new ConfigError('当前图谱没有可用的本机配置快照，请重新构建。', 409);
        let record;
        try {
          record = JSON.parse(raw);
        } catch {
          throw new ConfigError('本机构建记录损坏，请重新构建。', 409);
        }
        if (record.captureId !== captureId || record.version !== stateVersion(await read())) {
          throw new ConfigError('配置或凭据已变化，请重新构建。', 409);
        }
        return record;
      }),
    load: () =>
      serialize(async () => {
        const state = await read();
        return {project: state.project, roles: state.roles.map(role => publicRole(state, role))};
      }),
    saveProject: input =>
      serialize(async () => {
        const state = await read();
        if (input?.revision !== state.project.revision) throw conflict();
        const value = projectValue(input);
        state.doc.set('title', value.name);
        state.doc.set('baseUrl', value.baseUrl);
        updateAuthentication(state.doc, value.authentication);
        state.doc.set('allowRemoteUrls', value.allowRemoteUrls);
        await commit(state);
        return (await read()).project;
      }),
    saveRole: input =>
      serialize(async () => {
        const state = await read();
        const {draft, previous, password, fingerprint: key} = draftFor(state, input);
        const role = {
          ...previous,
          id: previous?.id ?? randomUUID(),
          tag: draft.tag,
          name: draft.name,
          enabled: previous?.enabled ?? true
        };
        const check = checks.get(draft.checkId);
        const old = state.secrets.roles[role.id];
        const matched = check?.fingerprint === key && check.expires > Date.now();
        const test = draft.checkId ? (matched ? check.test : undefined) : old?.test;
        state.secrets.roles[role.id] = {
          username: draft.username,
          password,
          nonce: old?.nonce ?? randomUUID(),
          ...(test?.fingerprint === key ? {test} : {})
        };
        state.roles = previous ? state.roles.map(item => (item.id === role.id ? role : item)) : [...state.roles, role];
        await commit(state);
        return publicRole(await read(), role);
      }),
    setEnabled: (id, enabled) =>
      serialize(async () => {
        if (typeof enabled !== 'boolean') throw new ConfigError('启停状态必须是布尔值。');
        const state = await read();
        const role = existing(state, id);
        role.enabled = enabled;
        await commit(state);
        return publicRole(state, role);
      }),
    deleteRole: (id, revision) =>
      serialize(async () => {
        const state = await read();
        if (typeof revision !== 'string') throw conflict();
        existing(state, id, revision);
        state.roles = state.roles.filter(role => role.id !== id);
        delete state.secrets.roles[id];
        await commit(state);
      }),
    prepareLogin: input =>
      serialize(async () => {
        const state = await read();
        const attempt = draftFor(state, input);
        return {
          project: state.project,
          role: {tag: attempt.draft.tag},
          credentials: {username: attempt.draft.username, password: attempt.password},
          fingerprint: attempt.fingerprint
        };
      }),
    recordLogin(attempt, result) {
      const checkId = randomUUID();
      for (const [id, check] of checks) if (check.expires <= Date.now()) checks.delete(id);
      if (checks.size >= 128) checks.delete(checks.keys().next().value);
      checks.set(checkId, {
        fingerprint: attempt.fingerprint,
        test: {fingerprint: attempt.fingerprint, status: result.status},
        expires: Date.now() + 300_000
      });
      return {...result, checkId};
    }
  };
}
