import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

for (const mode of ['same-entry', 'cross-entry', 'same-scope', 'file-link', 'entry-parent'])
  test(`authentication directory retarget is rejected in ${mode} through the real browser path`, async () => {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('./helpers/authentication-retarget.mjs', import.meta.url)),
      mode
    ]);
  });
