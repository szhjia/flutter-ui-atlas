#!/usr/bin/env node
import {runAtlas} from './index.mjs';

process.exitCode = await runAtlas();
