import { cp, access } from 'node:fs/promises';
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), new URL('../public/wasm/', import.meta.url), { recursive: true });
for (const name of ['face_landmarker', 'hand_landmarker']) {
  await access(new URL(`../public/models/${name}.task`, import.meta.url));
}
