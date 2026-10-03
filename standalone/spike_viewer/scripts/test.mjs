// SPDX-License-Identifier: Apache-2.0
import { build } from 'esbuild';
import { readdir, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = (await readdir('tests')).filter(file => file.endsWith('.test.ts'));
await mkdir('artifacts/tests', { recursive: true });
await build({ entryPoints: files.map(file => `./tests/${file}`), outdir: 'artifacts/tests', bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', outExtension: { '.js': '.mjs' } });
const run = spawnSync(process.execPath, ['--test', ...files.map(file => `artifacts/tests/${file.replace(/\.ts$/, '.mjs')}`)], { stdio: 'inherit' });
process.exitCode = run.status ?? 1;
