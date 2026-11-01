import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist-library/', root);
await rm(output, { recursive: true, force: true });
execFileSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', 'tsconfig.library.json'], { cwd: root, stdio: 'inherit' });
// TypeScript rewrites emitted JS imports, but leaves .ts suffixes in declaration imports.
for (const name of (await readdir(output)).filter(name => name.endsWith('.d.ts'))) {
  const path = new URL(name, output);
  await writeFile(path, (await readFile(path, 'utf8')).replace(/(from ['"]\.\/.+)\.ts(['"])/g, '$1.js$2'));
}
const project = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
await writeFile(new URL('package.json', output), JSON.stringify({
  name: '@gigadoc/video-analysis',
  version: '0.1.0',
  description: 'Browser video analysis: screen gaze, hand-over-eye detection and calibration',
  private: true,
  type: 'module',
  main: './index.js',
  types: './index.d.ts',
  exports: { '.': { types: './index.d.ts', import: './index.js' }, './core': { types: './vision.d.ts', import: './vision.js' }, './package.json': './package.json' },
  files: ['*.js', '*.d.ts', 'assets', 'README.md', 'example'],
  sideEffects: false,
  dependencies: { '@mediapipe/tasks-vision': project.dependencies['@mediapipe/tasks-vision'] },
}, null, 2) + '\n');
await mkdir(new URL('assets/', output));
await cp(new URL('public/models/', root), new URL('assets/models/', output), { recursive: true });
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root), new URL('assets/wasm/', output), { recursive: true });
await cp(new URL('docs/video-analysis.md', root), new URL('README.md', output));
await mkdir(new URL('example/', output));
for (const name of ['index.html', 'main.ts', 'copy-assets.mjs', 'tsconfig.json']) {
  await cp(new URL(`examples/integration/${name}`, root), new URL(`example/${name}`, output));
}
console.log('Library built in dist-library/ (ESM, types, models, WASM, example)');
