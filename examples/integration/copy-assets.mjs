import { cp, mkdir } from 'node:fs/promises';
const assets = new URL('./assets/', import.meta.resolve('@gigadoc/video-analysis/package.json'));
await mkdir('public', { recursive: true });
await cp(assets, 'public/video-analysis', { recursive: true });
console.log('Models and WASM copied to public/video-analysis/');
