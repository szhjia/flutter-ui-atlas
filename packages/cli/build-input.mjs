import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readFile, readdir, lstat, realpath} from 'node:fs/promises';
import {dirname, resolve, relative, isAbsolute, sep, join, extname} from 'node:path';
import {parse} from 'yaml';
import {init, parse as parseModule} from 'es-module-lexer';

export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(key => value[key] !== undefined)
        .map(key => [key, normalize(value[key])])
    );
  return value;
}
export const hash = value =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value))
    .digest('hex');
const excluded = new Set(['.git', '.atlas', 'build', '.dart_tool', 'node_modules']);
export async function fingerprintSources(config, directory) {
  const root = dirname(directory),
    files = new Map(),
    reasons = [],
    visited = new Set();
  const within = file => {
    const p = relative(root, file);
    return p !== '..' && !p.startsWith('..' + sep) && !isAbsolute(p);
  };
  async function walk(file, explicit = false, optional = false) {
    if (!within(file)) {
      reasons.push('Source outside application root requires a trusted fingerprint.');
      return;
    }
    if (
      relative(root, file)
        .split(sep)
        .some(p => excluded.has(p))
    ) {
      if (explicit) throw Error('Source input overlaps an excluded private or generated directory.');
      return;
    }
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error.code === 'ENOENT' && optional) return;
      throw error;
    }
    if (info.isSymbolicLink()) {
      reasons.push('Symbolic source inputs are not cacheable.');
      return;
    }
    if (info.isDirectory()) {
      for (const child of (await readdir(file)).sort()) await walk(join(file, child), false);
    } else if (info.isFile()) files.set(relative(root, file).split(sep).join('/'), hash(await readFile(file)));
  }
  async function packageInputs(packageRoot) {
    if (visited.has(packageRoot)) return;
    visited.add(packageRoot);
    if (!within(packageRoot)) {
      reasons.push('External path dependency is not covered.');
      return;
    }
    const pubspec = join(packageRoot, 'pubspec.yaml');
    await walk(pubspec);
    const spec = parse(await readFile(pubspec, 'utf8'));
    for (const name of ['lib', 'web', 'pubspec.lock']) await walk(join(packageRoot, name), false, true);
    for (const asset of spec?.flutter?.assets ?? []) {
      const path = typeof asset === 'string' ? asset : asset?.path;
      if (typeof path !== 'string') {
        reasons.push('Unrecognized asset declaration.');
        continue;
      }
      await walk(resolve(packageRoot, path), true);
    }
    for (const family of spec?.flutter?.fonts ?? [])
      for (const font of family.fonts ?? []) await walk(resolve(packageRoot, font.asset), true);
    for (const dependency of Object.values({
      ...spec?.dependencies,
      ...spec?.dev_dependencies,
      ...spec?.dependency_overrides
    })) {
      if (dependency && typeof dependency === 'object' && dependency.path)
        await packageInputs(resolve(packageRoot, dependency.path));
    }
  }
  if (config.sourceFiles?.length) {
    if (!Array.isArray(config.sourceFiles) || config.sourceFiles.some(p => typeof p !== 'string' || !p))
      throw Error('sourceFiles must contain file or directory paths.');
    for (const file of config.sourceFiles) await walk(resolve(directory, file), true);
  } else await packageInputs(root);
  let authentication;
  if (config.authentication?.type === 'module') {
    authentication = await fingerprintModule(resolve(await realpath(directory), config.authentication.module));
    reasons.push(...authentication.reasons);
  }
  const entries = [...files].sort(([a], [b]) => a.localeCompare(b));
  return {
    digest: hash([entries, authentication?.digest]),
    authenticationComplete: authentication?.complete ?? true,
    files: entries.map(([name]) => name),
    reusable: reasons.length === 0 && entries.length > 0,
    reasons: [...new Set(reasons)]
  };
}

export function workspaceCatalog(catalog, accountId) {
  const owner = s => s.accountId ?? s._role?.id ?? '@anonymous';
  const ids = new Set(catalog.screens.filter(s => owner(s) === accountId).map(s => s.id));
  const anonymous = new Set(catalog.screens.filter(s => owner(s) === '@anonymous').map(s => s.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of catalog.edges) {
      if (ids.has(e.source) && anonymous.has(e.target) && !ids.has(e.target)) {
        ids.add(e.target);
        changed = true;
      }
      if (ids.has(e.target) && anonymous.has(e.source) && !ids.has(e.source)) {
        ids.add(e.source);
        changed = true;
      }
    }
  }
  return {
    screens: catalog.screens.filter(s => ids.has(s.id)),
    edges: catalog.edges.filter(e => ids.has(e.source) && ids.has(e.target))
  };
}

export function captureInputs(snapshot, catalog, profile, source) {
  const screens = catalog.screens.map(({_role, _baseId, role, ...s}) => ({
    ...s,
    authentication:
      _role?.id === '@anonymous' ? undefined : {id: _role?.id, tag: _role?.tag, credentials: _role?.credentials}
  }));
  const edges = catalog.edges.map(({_from, _to, ...e}) => e);
  return {
    protocol: 2,
    nodeVersion: process.version,
    source: source.digest,
    screens,
    edges,
    viewport: profile.viewport,
    baseUrl: snapshot.project.baseUrl,
    publicPath: snapshot.config.publicPath ?? '/generated',
    authentication: screens.some(s => s.authentication) ? snapshot.project.authentication : undefined,
    authenticationRevision: screens.some(s => s.authentication) ? snapshot.project.authenticationRevision : undefined,
    browserChannel: process.env.ATLAS_BROWSER_CHANNEL ?? snapshot.config.browserChannel ?? 'chrome',
    routeMode: snapshot.config.routeMode,
    timeoutMs: snapshot.config.timeoutMs,
    requireObservedEdges: snapshot.config.requireObservedEdges
  };
}

/** Conservative local ESM dependency closure for trusted authentication modules. */
export async function fingerprintModule(entry) {
  const files = new Map(),
    resolutions = new Map(),
    reasons = [];
  entry = resolve(entry);
  async function visit(file) {
    file = resolve(file);
    const target = await realpath(file);
    resolutions.set(file, target);
    if (target !== file) reasons.push('Symbolic authentication inputs are not cacheable.');
    file = target;
    if (files.has(file)) return;
    const info = await lstat(file);
    if (!info.isFile()) {
      reasons.push('Authentication module dependencies must be regular files.');
      return;
    }
    const source = await readFile(file, 'utf8');
    files.set(file, hash(source));
    // .cjs can alias require; .js also depends on package format outside this graph.
    if (extname(file) !== '.mjs') {
      reasons.push('Only .mjs authentication dependencies have a statically verified ESM graph.');
      return;
    }
    await init;
    let imports;
    try {
      [imports] = parseModule(source, file);
    } catch {
      reasons.push('Authentication module syntax cannot be analyzed.');
      return;
    }
    if (/\brequire(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*\(/.test(source))
      reasons.push('Dynamic authentication dependencies cannot be fingerprinted.');
    for (const item of imports) {
      if (item.d === -2) continue; // import.meta is not an import specifier.
      const specifier = item.n;
      if (typeof specifier !== 'string') {
        reasons.push('Dynamic authentication dependencies cannot be fingerprinted.');
        continue;
      }
      // createRequire can escape the static ESM graph under any local alias.
      if (specifier === 'node:module') {
        reasons.push('Node module loaders cannot be fingerprinted; authentication cache reuse is disabled.');
        continue;
      }
      if (specifier.startsWith('node:')) continue;
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        reasons.push('External authentication dependencies cannot be fingerprinted.');
        continue;
      }
      if (/[?#]/.test(specifier)) {
        reasons.push('Authentication dependency URLs cannot be fingerprinted.');
        continue;
      }
      await visit(fileURLToPath(new URL(specifier, pathToFileURL(file))));
    }
  }
  await visit(entry);
  return {
    digest: hash({
      files: [...files]
        .map(([path, digest]) => [relative(dirname(entry), path), digest])
        .sort(([a], [b]) => a.localeCompare(b)),
      resolutions: [...resolutions]
        .map(([request, target]) => [relative(dirname(entry), request), relative(dirname(entry), target)])
        .sort(([a], [b]) => a.localeCompare(b))
    }),
    resolutions: [...resolutions].map(([request, target]) => ({request, target})),
    files: [...files].map(([path, digest]) => ({path, digest})),
    complete: !reasons.length,
    reasons
  };
}
