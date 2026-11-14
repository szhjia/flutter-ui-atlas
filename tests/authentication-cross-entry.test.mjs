import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

for (const mode of ['esm', 'commonjs']) {
  test(`cross-entry ${mode} authentication honors the process-wide dependency cache boundary`, async () => {
    // Each service needs its own Node module cache, just like a real restart.
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('./helpers/authentication-cross-entry.mjs', import.meta.url)),
      mode
    ]);
  });
}
