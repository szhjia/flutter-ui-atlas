import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const destination = resolve(process.argv[2] ?? '.runtime/packages');
const stage = await mkdtemp(join(tmpdir(), 'flutter-ui-atlas-pack-'));

try {
  const manifest = {
    name: source.name, version: source.version, type: source.type, description: source.description,
    engines: {node: '>=22'},
    bin: {atlas: './packages/cli/atlas.mjs'},
    files: ['dist', 'packages/cli', 'packages/capture'],
    dependencies: {playwright: source.devDependencies.playwright, yaml: source.devDependencies.yaml},
  };
  await mkdir(join(stage, 'packages/capture'), {recursive: true});
  await cp(join(root, 'packages/cli'), join(stage, 'packages/cli'), {recursive: true});
  for (const file of await readdir(join(root, 'packages/capture'))) {
    if (file.endsWith('.mjs')) await cp(join(root, 'packages/capture', file), join(stage, 'packages/capture', file));
  }
  await cp(join(root, 'dist'), join(stage, 'dist'), {recursive: true});
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(destination, {recursive: true});
  execFileSync('npm', ['pack', '--pack-destination', destination], {cwd: stage, stdio: 'inherit'});
} finally {
  await rm(stage, {recursive: true, force: true});
}
