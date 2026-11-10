import {fileURLToPath} from 'node:url';
import {runAtlas} from '../packages/cli/index.mjs';

process.exitCode = await runAtlas(['capture', '--config', fileURLToPath(new URL('./atlas.config.json', import.meta.url))]);
