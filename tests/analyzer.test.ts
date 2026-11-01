import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaceLandmarker, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { VideoAnalyzer, Calibration, observe } from '../src/video-analysis/index.ts';

// Only the external ML runtime is substituted. Exercise the actual public API and lifecycle.
const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

test('library import and calibration do not access DOM or camera', async () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(new Calibration().baseline, null);
  assert.equal(observe([], [], 0, null).valid, false);
  await assert.rejects(VideoAnalyzer.create({ assetsBaseUrl: '' }), /assetsBaseUrl/);
});

test('configured assets, inference timestamps, unknown frames, idempotent close and independent instances', async t => {
  const calls: number[] = [], paths: string[] = [];
  let faceClosed = 0, handClosed = 0;
  t.mock.method(FilesetResolver, 'forVisionTasks', async (path: string) => { paths.push(path); return {}; });
  t.mock.method(FaceLandmarker, 'createFromOptions', async (_files: unknown, options: { baseOptions: { modelAssetPath: string } }) => {
    paths.push(options.baseOptions.modelAssetPath);
    return { detectForVideo: (v: unknown, at: number) => { assert.equal(v, video); calls.push(at); return { faceLandmarks: [] }; }, close: () => faceClosed++ };
  });
  t.mock.method(HandLandmarker, 'createFromOptions', async (_files: unknown, options: { baseOptions: { modelAssetPath: string } }) => {
    paths.push(options.baseOptions.modelAssetPath);
    return { detectForVideo: () => ({ landmarks: [] }), close: () => handClosed++ };
  });
  const a = await VideoAnalyzer.create({ assetsBaseUrl: '/other-app/analysis/' });
  const b = await VideoAnalyzer.create({ assetsBaseUrl: 'https://example.test/static/' });
  assert.deepEqual(paths.slice(0, 3), ['/other-app/analysis/wasm', '/other-app/analysis/models/face_landmarker.task', '/other-app/analysis/models/hand_landmarker.task']);
  assert.equal(paths[3], 'https://example.test/static/wasm');
  assert.equal(a.analyze({ readyState: 0 } as HTMLVideoElement, 1).valid, false);
  assert.deepEqual(calls, []);
  const o = a.analyze(video, 2);
  assert.equal(o.at, 2); assert.equal(o.gaze, null);
  assert.deepEqual(o.covered, { left: null, right: null });
  for (const invalid of [2, 1, NaN, Infinity, -1]) assert.throws(() => a.analyze(video, invalid), RangeError);
  assert.deepEqual(calls, [2]);
  a.close(); a.close();
  assert.equal(faceClosed, 1); assert.equal(handClosed, 1);
  assert.throws(() => a.analyze(video, 3), /closed/);
  assert.equal(b.analyze(video, 0).at, 0);
  b.close(); assert.equal(faceClosed, 2); assert.equal(handClosed, 2);
});

test('GPU partial failure closes its face model before CPU fallback', async t => {
  const order: string[] = [];
  t.mock.method(FilesetResolver, 'forVisionTasks', async () => ({}));
  t.mock.method(FaceLandmarker, 'createFromOptions', async (_files: unknown, options: { baseOptions: { delegate: string } }) => {
    const delegate = options.baseOptions.delegate; order.push(`face:${delegate}`);
    return { close: () => order.push(`close-face:${delegate}`) };
  });
  t.mock.method(HandLandmarker, 'createFromOptions', async (_files: unknown, options: { baseOptions: { delegate: string } }) => {
    const delegate = options.baseOptions.delegate; order.push(`hand:${delegate}`);
    if (delegate === 'GPU') throw new Error('GPU unavailable');
    return { close: () => order.push(`close-hand:${delegate}`) };
  });
  const analyzer = await VideoAnalyzer.create({ assetsBaseUrl: '/assets' });
  assert.deepEqual(order, ['face:GPU', 'hand:GPU', 'close-face:GPU', 'face:CPU', 'hand:CPU']);
  analyzer.close();
  assert.deepEqual(order.slice(-2), ['close-face:CPU', 'close-hand:CPU']);
});

test('failed initialization frees partial models and preserves failure', async t => {
  let closed = 0;
  t.mock.method(FilesetResolver, 'forVisionTasks', async () => ({}));
  t.mock.method(FaceLandmarker, 'createFromOptions', async () => ({ close: () => closed++ }));
  t.mock.method(HandLandmarker, 'createFromOptions', async () => { throw new Error('Model missing'); });
  await assert.rejects(VideoAnalyzer.create({ assetsBaseUrl: '/assets' }), /Model missing/);
  assert.equal(closed, 2);
});

test('zoom crops the same frame for both models, reuses canvas and validates input', async t => {
  const draws: unknown[][] = [], inputs: unknown[] = [];
  let created = 0;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args: unknown[]) => draws.push(args) }) };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => { assert.equal(tag, 'canvas'); created++; return canvas; } } });
  t.after(() => { Reflect.deleteProperty(globalThis, 'document'); });
  t.mock.method(FilesetResolver, 'forVisionTasks', async () => ({}));
  t.mock.method(FaceLandmarker, 'createFromOptions', async () => ({ detectForVideo: (frame: unknown) => { inputs.push(frame); return { faceLandmarks: [] }; }, close() {} }));
  t.mock.method(HandLandmarker, 'createFromOptions', async () => ({ detectForVideo: (frame: unknown) => { inputs.push(frame); return { landmarks: [] }; }, close() {} }));
  for (const zoom of [0, 0.9, 3.1, NaN, Infinity]) await assert.rejects(VideoAnalyzer.create({ assetsBaseUrl: '/assets', zoom }), RangeError);
  const a = await VideoAnalyzer.create({ assetsBaseUrl: '/assets', zoom: 2 });
  assert.equal(a.zoom, 2);
  a.analyze(video, 1);
  assert.deepEqual(draws[0], [video, 160, 120, 320, 240, 0, 0, 640, 480]);
  assert.equal(inputs[0], canvas); assert.equal(inputs[1], canvas);
  const portrait = { readyState: 4, videoWidth: 480, videoHeight: 640 } as HTMLVideoElement;
  a.analyze(portrait, 2);
  assert.deepEqual(draws[1], [portrait, 120, 160, 240, 320, 0, 0, 480, 640]);
  assert.equal(created, 1);
  assert.throws(() => a.setZoom(4), RangeError); assert.equal(a.zoom, 2);
  a.setZoom(1); a.analyze(video, 3);
  assert.equal(inputs.at(-1), video); assert.equal(draws.length, 2);
  a.close(); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  assert.throws(() => a.setZoom(2), /closed/);
});
