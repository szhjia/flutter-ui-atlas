import {randomUUID} from 'node:crypto';
import {readFile, writeFile, lstat} from 'node:fs/promises';
import {join} from 'node:path';

export async function ensureApplicationIdentity(directory) {
  const file = join(directory, 'identity.json');
  try {
    await writeFile(file, JSON.stringify({applicationId: randomUUID()}), {flag: 'wx', mode: 0o600});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (!(await lstat(file)).isFile()) throw Error('Application identity must be a regular file.');
  const {applicationId} = JSON.parse(await readFile(file, 'utf8'));
  if (!/^[a-f0-9-]{36}$/.test(applicationId))
    throw Error('Invalid application identity. Restore identity.json from a backup.');
  return applicationId;
}
