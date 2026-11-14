import {validateAtlasOutput, selectProfiles} from './project.mjs';
import {projectValue} from './config-values.mjs';
import {readFile, access, stat, lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, join} from 'node:path';
import {fingerprintSources} from './build-input.mjs';
import {launchManagedBrowser} from './managed-browser.mjs';
const require = createRequire(import.meta.url);
export async function diagnose({config, directory, launchBrowser, installationOnly = false} = {}) {
  const checks = [];
  async function check(name, work, remedy) {
    try {
      const details = await work();
      checks.push({name, ok: true, details});
    } catch {
      checks.push({name, ok: false, remedy});
    }
  }
  await check(
    'node',
    async () => {
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (major < 22 || major > 26 || (major === 26 && minor >= 13)) throw Error();
      return process.versions.node;
    },
    'Use a Node.js version supported by package.json (>=22 <26.13).'
  );
  await check(
    'modules',
    async () => {
      for (const name of ['playwright', 'yaml', 'es-module-lexer']) require.resolve(name);
      return 'Runtime dependencies resolved.';
    },
    'Reinstall the Atlas package with its runtime dependencies.'
  );
  await check(
    'viewer',
    async () => {
      const root = fileURLToPath(new URL('../../dist/', import.meta.url));
      const html = await readFile(resolve(root, 'index.html'), 'utf8');
      if (!html.includes('id="atlas-config"')) throw Error();
      for (const [, path] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g))
        await access(resolve(root, path.slice(1)));
      return 'Prebuilt Viewer and referenced assets found.';
    },
    'Install a complete Atlas tarball; source checkouts must run pnpm build.'
  );
  await check(
    'browser',
    async () => {
      const browser = await (
        launchBrowser ??
        (() => launchManagedBrowser({channel: process.env.ATLAS_BROWSER_CHANNEL ?? config?.browserChannel ?? 'chrome'}))
      )();
      try {
        const context = await browser.newContext();
        await context.close();
      } finally {
        await browser.close();
      }
      return 'Isolated browser context opened and closed.';
    },
    'Install Google Chrome, or configure an installed browser channel. Atlas does not download browsers.'
  );
  if (config && !installationOnly) {
    await check(
      'configuration',
      async () => {
        selectProfiles(config);
        projectValue({
          name: config.title ?? 'Application',
          baseUrl: config.baseUrl,
          authentication: config.authentication ?? {type: 'none'},
          allowRemoteUrls: config.allowRemoteUrls ?? false
        });
        return 'Application settings and viewport declarations are valid.';
      },
      'Correct application settings and profiles in .atlas/atlas.yaml.'
    );
    await check(
      'identity',
      async () => {
        try {
          const file = join(directory, 'identity.json');
          const info = await lstat(file);
          if (!info.isFile()) throw Error();
          const value = JSON.parse(await readFile(file, 'utf8'));
          if (!/^[a-f0-9-]{36}$/.test(value.applicationId)) throw Error();
          return 'Stable application identity is valid.';
        } catch (error) {
          if (error.code === 'ENOENT') return 'Identity will be created by the first build.';
          throw error;
        }
      },
      'Restore a valid .atlas/identity.json from a backup; do not invent a replacement for an existing application.'
    );
    await check(
      'application',
      async () => {
        const response = await fetch(config.baseUrl, {signal: AbortSignal.timeout(5000), redirect: 'error'});
        if (!response.ok) throw Error();
        return 'Web URL reachable; authentication has not been checked.';
      },
      'Start your application using its normal tools and check baseUrl.'
    );
    await check(
      'output',
      async () => {
        const output = resolve(directory, config.output ?? 'generated');
        await validateAtlasOutput(directory, output);
        let parent = output;
        for (;;) {
          try {
            await access(parent, constants.W_OK);
            break;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            parent = dirname(parent);
          }
        }
        return 'Output path is private and writable.';
      },
      'Check local .atlas directory permissions.'
    );
    await check(
      'sources',
      async () => {
        const source = await fingerprintSources(config, directory);
        if (!source.reusable) throw Error();
        return {files: source.files};
      },
      'Declare complete project-local sourceFiles; unsupported external inputs disable cache reuse.'
    );
  }
  return {ok: checks.every(c => c.ok), checks};
}
