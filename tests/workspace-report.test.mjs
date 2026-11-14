import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readWorkspaceManifest} from '../packages/cli/workspace-build.mjs';

test('report corruption cannot invalidate committed workspaces or invent reuse', async t => {
  const output = await mkdtemp(join(tmpdir(), 'atlas-report-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  const generationId = randomUUID();
  const accounts = ['reader', 'admin'].map(name => ({id: randomUUID(), name}));
  const refs = {};
  for (const account of accounts) {
    const revisionId = randomUUID();
    refs[account.id] = {revisionId};
    await mkdir(join(output, 'revisions', revisionId), {recursive: true});
    await writeFile(
      join(output, 'revisions', revisionId, 'manifest.json'),
      JSON.stringify({
        revisionId,
        accountId: account.id,
        captureId: account.id,
        capturedAt: 'original',
        screens: [],
        edges: []
      })
    );
  }
  const indexFile = join(output, 'index.json');
  await writeFile(indexFile, JSON.stringify({schemaVersion: 2, generationId, accounts, profiles: {'@default': refs}}));
  const originalIndex = await readFile(indexFile, 'utf8');
  const baseline = await readWorkspaceManifest(output);
  const revision = refs[accounts[0].id].revisionId;
  const reportFile = join(output, 'latest-attempt.json');
  const invalid = [
    '{',
    'null',
    '[]',
    '{}',
    ...[{}, true, 42, revision, null, [revision, 7]].map(reusedRevisions => JSON.stringify({reusedRevisions}))
  ];
  for (const report of invalid) {
    await writeFile(reportFile, report);
    assert.deepEqual(await readWorkspaceManifest(output), baseline, report);
    assert.equal(await readFile(reportFile, 'utf8'), report);
    assert.equal(await readFile(indexFile, 'utf8'), originalIndex);
  }
  await writeFile(reportFile, JSON.stringify({reusedRevisions: [revision]}));
  const valid = await readWorkspaceManifest(output);
  assert.deepEqual(
    valid.workspaces.map(w => w.map.reused),
    [true, false]
  );
  // The authoritative map must still fail closed; report tolerance is not JSON-wide.
  await writeFile(indexFile, '{');
  await assert.rejects(readWorkspaceManifest(output), SyntaxError);
  await writeFile(indexFile, originalIndex);
  await writeFile(join(output, 'revisions', revision, 'manifest.json'), '{');
  await assert.rejects(readWorkspaceManifest(output), SyntaxError);
});
