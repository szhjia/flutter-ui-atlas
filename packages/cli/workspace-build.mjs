import {randomUUID, randomBytes, createHmac} from 'node:crypto';
import {readFile, writeFile, mkdir, rename, lstat, rm} from 'node:fs/promises';
import {join, relative, resolve, isAbsolute} from 'node:path';
import {capture} from '../capture/index.mjs';
import {acquireOutputLock} from '../capture/lock.mjs';
import {createConfigStore} from './config-store.mjs';
import {createProjectAdapter} from './project-runtime.mjs';
import {expandCatalog} from './project-catalog.mjs';
import {ensureApplicationIdentity} from './application-identity.mjs';
import {fingerprintSources, captureInputs, workspaceCatalog, hash, canonical} from './build-input.mjs';
import {validateAtlasOutput} from './project.mjs';
import {assertApplicationReachable} from './application-reachability.mjs';

export async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
async function atomic(file, value, mode = 0o600, beforeRename) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), {mode, flag: 'wx'});
    await beforeRename?.();
    await rename(temporary, file);
  } finally {
    await rm(temporary, {force: true}).catch(() => {});
  }
}
// Cache metadata is reconstructible; the published index remains authoritative.
async function readCacheState(file) {
  let state;
  try {
    state = await optionalJson(file);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (state?.records && typeof state.records === 'object' && !Array.isArray(state.records)) return state;
  return null;
}
const profileKey = profile => profile.name ?? '@default';
// Reports only annotate the committed map; malformed report data cannot invalidate it.
async function readReusedRevisions(output) {
  let report;
  try {
    report = await optionalJson(join(output, 'latest-attempt.json'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const revisions = report?.reusedRevisions;
  return Array.isArray(revisions) && revisions.every(id => typeof id === 'string') ? revisions : [];
}
export async function privateKey(directory) {
  const file = join(directory, 'cache-key');
  try {
    await writeFile(file, randomBytes(32), {flag: 'wx', mode: 0o600});
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  if (!(await lstat(file)).isFile()) throw Error('Cache key must be a regular file.');
  return readFile(file);
}
export const dependencyKey = (secret, inputs) => createHmac('sha256', secret).update(canonical(inputs)).digest('hex');
/** @param {string} output @param {string | null} profileName */
export async function readWorkspaceManifest(output, profileName = null) {
  const index = await optionalJson(join(output, 'index.json'));
  if (!index) return null;
  if (!/^[a-f0-9-]{36}$/.test(index.generationId)) throw Error('Invalid workspace generation.');
  if (index.schemaVersion !== 2) throw Error('Unsupported workspace index.');
  const refs = index.profiles[profileName ?? '@default'];
  if (!refs) return null;
  const workspaces = [];
  for (const account of index.accounts) {
    const ref = refs[account.id];
    if (!ref) continue;
    if (!/^[a-f0-9-]{36}$/.test(ref.revisionId)) throw Error('Invalid workspace revision.');
    const map = await optionalJson(join(output, 'revisions', ref.revisionId, 'manifest.json'));
    if (!map) throw Error('Workspace revision is missing. Rebuild the map.');
    workspaces.push({
      id: account.id,
      name: account.name,
      map: {
        ...map,
        screens: map.screens.map(s => ({...s, role: index.accounts.find(a => a.id === s.accountId)?.name ?? s.role}))
      }
    });
  }
  if (!workspaces.length) return null;
  const reusedRevisions = await readReusedRevisions(output);
  for (const workspace of workspaces) workspace.map.reused = reusedRevisions.includes(workspace.map.revisionId);
  return {
    ...workspaces[0].map,
    applicationId: index.applicationId,
    profileId: profileName ?? '@default',
    generationId: index.generationId,
    workspaces
  };
}
async function integrity(output, map, revisionId) {
  const paths = new Set([`revisions/${revisionId}/manifest.json`]);
  for (const screen of map.screens) {
    if (!screen.image) continue;
    const match = screen.image.match(/\/captures\/([0-9TZ-]+)\/([0-9]+\.png)$/);
    if (!match) throw Error('Invalid capture resource.');
    paths.add(`captures/${match[1]}/${match[2]}`);
  }
  return Object.fromEntries(
    await Promise.all([...paths].map(async path => [path, hash(await readFile(join(output, path)))]))
  );
}
async function validRecord(output, record, key) {
  if (!record || record.key !== key || !record.integrity || !record.revisionId) return false;
  try {
    for (const [path, digest] of Object.entries(record.integrity)) {
      if (!/^(?:revisions\/[a-f0-9-]{36}\/manifest\.json|captures\/[0-9TZ-]+\/[0-9]+\.png)$/.test(path)) return false;
      if (hash(await readFile(join(output, path))) !== digest) return false;
    }
    const map = await optionalJson(join(output, 'revisions', record.revisionId, 'manifest.json'));
    if (!map || map.revisionId !== record.revisionId || !Array.isArray(map.screens) || !Array.isArray(map.edges))
      return false;
    return canonical(await integrity(output, map, record.revisionId)) === canonical(record.integrity);
  } catch {
    return false;
  }
}

export async function buildWorkspaces(input, profiles, launchBrowser, {force = false} = {}) {
  await validateAtlasOutput(input.directory, input.output);
  const stateDir = join(input.directory, 'build-state');
  await validateAtlasOutput(input.directory, stateDir);
  await mkdir(stateDir, {recursive: true, mode: 0o700});
  const release = await acquireOutputLock(stateDir);
  const attemptId = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    const store = await createConfigStore({configFile: join(input.directory, 'atlas.yaml')});
    const snapshot = await store.readBuildSnapshot();
    if (canonical({...snapshot.config, output: snapshot.config.output ?? 'generated'}) !== canonical(input.config))
      throw Error('Configuration changed before build. Retry the command.');
    const applicationId = await ensureApplicationIdentity(input.directory);
    const source = await fingerprintSources(snapshot.config, input.directory);
    const catalog = expandCatalog(snapshot.config, snapshot.roles);
    const secret = await privateKey(stateDir);
    const previous = await optionalJson(join(input.output, 'index.json'));
    const previousState = previous ? await readCacheState(join(stateDir, `${previous.generationId}.json`)) : null;
    const accounts = snapshot.roles.filter(r => r.enabled).map(({id, name}) => ({id, name}));
    if (catalog.screens.some(s => s.accountId === '@anonymous')) accounts.push({id: '@anonymous', name: 'Signed out'});
    const index = {
      schemaVersion: 2,
      applicationId,
      generationId: randomUUID(),
      accounts,
      profiles: structuredClone(previous?.profiles ?? {})
    };
    const records = {...previousState?.records};
    let captured = 0,
      reused = 0;
    let preflightDone = false;
    const reusedRevisions = [];
    await validateAtlasOutput(input.directory, join(input.output, 'captures'));
    await validateAtlasOutput(input.directory, join(input.output, 'revisions'));
    await mkdir(join(input.output, 'captures'), {recursive: true});
    await mkdir(join(input.output, 'revisions'), {recursive: true});
    for (const profile of profiles) {
      const pk = profileKey(profile);
      index.profiles[pk] = {};
      // Anonymous evidence is captured once, before any account that references it.
      const ordered = [...accounts].sort((a, b) => Number(b.id === '@anonymous') - Number(a.id === '@anonymous'));
      let shared;
      for (const account of ordered) {
        const subset = workspaceCatalog(catalog, account.id);
        if (!subset.screens.length) continue;
        const inputs = captureInputs(snapshot, subset, profile, source);
        const key = dependencyKey(secret, inputs);
        const slot = `${pk}/${account.id}`;
        const old = previousState?.records?.[slot];
        let map, record;
        if (
          !force &&
          source.reusable &&
          previous?.profiles?.[pk]?.[account.id]?.revisionId === old?.revisionId &&
          (await validRecord(input.output, old, key))
        ) {
          record = old;
          map = await optionalJson(join(input.output, 'revisions', record.revisionId, 'manifest.json'));
          reused++;
          reusedRevisions.push(record.revisionId);
        } else {
          if (!preflightDone) {
            try {
              await assertApplicationReachable(snapshot.project.baseUrl);
            } catch {
              throw Error('Application is unreachable. Start its Web server and check baseUrl.');
            }
            preflightDone = true;
          }
          const adapter = createProjectAdapter({snapshot, profile});
          adapter.catalog = async () => subset;
          adapter.sourceFingerprint = async () => (await fingerprintSources(snapshot.config, input.directory)).digest;
          // The application index is the sole commit point; legacy snapshot records are not publication.
          delete adapter.beforePublish;
          const result = await capture({
            output: join(input.output, 'captures'),
            publicPath: `${input.publicPath}/captures`,
            viewport: profile.viewport,
            requireObservedEdges: snapshot.config.requireObservedEdges,
            adapter,
            launchBrowser,
            reusableScreens:
              account.id === '@anonymous'
                ? []
                : (shared?.screens ?? []).filter(s => subset.screens.some(t => t.id === s.id))
          });
          if (
            result.screens.some(s => s.status !== 'captured') ||
            result.edges.some(e => e.status === 'failed') ||
            result.runtimeErrors.length
          )
            throw Error(
              result.screens.find(s => s.error)?.error ??
                result.edges.find(e => e.reason)?.reason ??
                'Capture failed. The last successful workspace remains current.'
            );
          const revisionId = randomUUID();
          map = {
            ...result,
            schemaVersion: 2,
            sourceFingerprint: '',
            applicationId,
            accountId: account.id,
            profileId: pk,
            revisionId
          };
          await mkdir(join(input.output, 'revisions', revisionId));
          await atomic(join(input.output, 'revisions', revisionId, 'manifest.json'), map);
          record = {key, revisionId, integrity: await integrity(input.output, map, revisionId)};
          captured++;
        }
        if (account.id === '@anonymous') shared = map;
        index.profiles[pk][account.id] = {revisionId: record.revisionId};
        records[slot] = record;
        console.log(
          JSON.stringify({
            accountId: account.id,
            profile: profile.name,
            captureId: map.captureId,
            capturedAt: map.capturedAt,
            reused: record === old
          })
        );
      }
    }
    // Account removal applies to all profiles, without deleting historical evidence.
    for (const refs of Object.values(index.profiles))
      for (const id of Object.keys(refs)) if (!accounts.some(a => a.id === id)) delete refs[id];
    const nowSource = await fingerprintSources(snapshot.config, input.directory);
    if (source.digest !== nowSource.digest) throw Error('Source changed during build. Previous map retained.');
    await snapshot.withCurrent(async assertCurrent => {
      await assertCurrent();
      const unchanged =
        previous && canonical({...index, generationId: ''}) === canonical({...previous, generationId: ''});
      if (!unchanged) await atomic(join(stateDir, `${index.generationId}.json`), {records});
      // Finish required publication writes before switching the sole map commit point.
      // A report failure must leave the previous successful index untouched.
      await atomic(join(input.output, 'latest-attempt.json'), {
        captureId: attemptId,
        completedAt: new Date().toISOString(),
        status: 'passed',
        failedScreens: 0,
        failedEdges: 0,
        error: null,
        report: '',
        reusedRevisions
      });
      await assertCurrent();
      const assertPublishInputs = async () => {
        const currentSource = await fingerprintSources(snapshot.config, input.directory);
        if (source.digest !== currentSource.digest)
          throw Error('Source changed during publication. Previous map retained.');
        await assertCurrent();
      };
      if (!unchanged) await atomic(join(input.output, 'index.json'), index, 0o600, assertPublishInputs);
      else await assertPublishInputs();
    });
    console.log(
      JSON.stringify({
        capturedWorkspaces: captured,
        reusedWorkspaces: reused,
        cacheable: source.reusable,
        reasons: source.reasons
      })
    );
    return 0;
  } catch (error) {
    await mkdir(input.output, {recursive: true});
    await atomic(join(input.output, 'latest-attempt.json'), {
      captureId: attemptId,
      completedAt: new Date().toISOString(),
      status: 'failed',
      failedScreens: 0,
      failedEdges: 0,
      stage: 'workspace',
      error: error.message,
      report: ''
    });
    console.error(error.message);
    return 1;
  } finally {
    await release();
  }
}

/** Freshness is dependency-scoped; an unrelated account edit does not stale this workspace. */
export async function annotateWorkspaceFreshness(bundle, directory) {
  try {
    const store = await createConfigStore({configFile: join(directory, 'atlas.yaml')});
    const snapshot = await store.readBuildSnapshot();
    const source = await fingerprintSources(snapshot.config, directory);
    const catalog = expandCatalog(snapshot.config, snapshot.roles);
    const stateDir = join(directory, 'build-state');
    const state = await optionalJson(join(stateDir, `${bundle.generationId}.json`));
    const secret = await privateKey(stateDir);
    const profiles = snapshot.config.profiles ?? {'@default': snapshot.config.viewport ?? {width: 393, height: 852}};
    for (const workspace of bundle.workspaces) {
      const viewport = profiles[workspace.map.profileId];
      const inputs = viewport && captureInputs(snapshot, workspaceCatalog(catalog, workspace.id), {viewport}, source);
      workspace.map.configurationChanged =
        !source.reusable ||
        !inputs ||
        state?.records?.[`${workspace.map.profileId}/${workspace.id}`]?.key !== dependencyKey(secret, inputs);
    }
  } catch {
    for (const workspace of bundle.workspaces) workspace.map.configurationChanged = true;
  }
  return bundle;
}

/** Custom/record writers share the application gate and publish a non-cacheable v2 view. */
export async function withApplicationWriter(input, work) {
  if (!input.managed) return work();
  const stateDir = join(input.directory, 'build-state');
  await validateAtlasOutput(input.directory, stateDir);
  await mkdir(stateDir, {recursive: true, mode: 0o700});
  const release = await acquireOutputLock(stateDir);
  try {
    return await work();
  } finally {
    await release();
  }
}
export async function publishLegacyWorkspaces(input, result) {
  if (
    !input.managed ||
    !result ||
    result.runtimeErrors?.length ||
    result.screens.some(s => s.status === 'failed') ||
    result.edges.some(e => e.status === 'failed')
  )
    return;
  const applicationId = await ensureApplicationIdentity(input.directory);
  const catalog = {...result, screens: result.screens.map(s => ({...s, accountId: s.accountId ?? `legacy:${s.role}`}))};
  const accounts = [...new Map(catalog.screens.map(s => [s.accountId, {id: s.accountId, name: s.role}])).values()];
  const index = {schemaVersion: 2, applicationId, generationId: randomUUID(), accounts, profiles: {'@default': {}}};
  await validateAtlasOutput(input.directory, join(input.output, 'revisions'));
  await mkdir(join(input.output, 'revisions'), {recursive: true});
  for (const account of accounts) {
    const revisionId = randomUUID();
    const map = {
      ...result,
      ...workspaceCatalog(catalog, account.id),
      schemaVersion: 2,
      sourceFingerprint: '',
      applicationId,
      profileId: '@default',
      accountId: account.id,
      revisionId
    };
    await mkdir(join(input.output, 'revisions', revisionId));
    await atomic(join(input.output, 'revisions', revisionId, 'manifest.json'), map);
    index.profiles['@default'][account.id] = {revisionId};
  }
  await atomic(join(input.output, 'index.json'), index);
}
