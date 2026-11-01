import { VideoAnalyzer, Calibration, LIMITS, unknown } from '@gigadoc/video-analysis';
import type { Observation } from '@gigadoc/video-analysis';

const video = document.querySelector<HTMLVideoElement>('#video')!;
const status = document.querySelector<HTMLElement>('#status')!;
const result = document.querySelector<HTMLElement>('#result')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const calibrationText = document.querySelector<HTMLElement>('#calibration')!;
const calibration = new Calibration();
let analyzer: VideoAnalyzer | null = null;
let stream: MediaStream | null = null;
let latest: Observation = unknown(0);
let callback = 0;
let canvasTimer = 0;
let lastRun = -Infinity;
let generation = 0;
let loading = false;

function controls() {
  for (const id of ['start', 'test']) document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = loading || !!analyzer;
  document.querySelector<HTMLButtonElement>('#stop')!.disabled = !loading && !analyzer;
  document.querySelector<HTMLButtonElement>('#reset')!.disabled = !analyzer;
}

function stop() {
  generation++; loading = false;
  if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(callback);
  clearInterval(canvasTimer);
  analyzer?.close(); analyzer = null;
  // The consuming app owns the camera. VideoAnalyzer.close() never stops these tracks.
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  video.pause(); video.srcObject = null;
  latest = unknown(performance.now(), 'Анализ остановлен');
  status.textContent = 'Видео остановлено, модели освобождены.';
  controls(); render();
}

function render() {
  const o = document.hidden || performance.now() - latest.at > LIMITS.staleMs
    ? unknown(latest.at, 'Нет свежего результата') : latest;
  result.textContent = JSON.stringify({ valid: o.valid, gaze: o.gaze, covered: o.covered, reason: o.reason }, null, 2);
  const step = { center: 'Смотрите в центр видео, оба глаза открыты.', left: 'Прикройте левый глаз ладонью.', right: 'Прикройте правый глаз ладонью.', done: 'Калибровка завершена. Можно проверять взгляд и руку.' };
  calibrationText.textContent = analyzer ? `${step[calibration.step]} ${calibration.step !== 'done' ? calibration.hint : ''}` : '';
  progress.value = analyzer ? calibration.progress : 0;
}

function frame(now: number) {
  if (!analyzer) return;
  if (!document.hidden && now - lastRun >= 100) {
    lastRun = now;
    try {
      latest = analyzer.analyze(video, now, calibration.baseline);
      calibration.update(latest, now);
    } catch (error) {
      stop(); status.textContent = error instanceof Error ? error.message : 'Ошибка анализа'; return;
    }
  }
  callback = video.requestVideoFrameCallback(frame);
}

function testStream() {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
  const context = canvas.getContext('2d')!;
  canvasTimer = window.setInterval(() => {
    context.fillStyle = '#e1e8d8'; context.fillRect(0, 0, 640, 480);
    context.fillStyle = '#263c32'; context.font = '24px sans-serif';
    context.fillText('TEST — NO CAMERA', 180, 220);
    context.fillText(String(Date.now()).slice(-5), 260, 270);
  }, 70);
  return canvas.captureStream(15);
}

async function start(synthetic: boolean) {
  stop(); calibration.reset(); lastRun = -Infinity;
  const ownGeneration = generation;
  loading = true; controls();
  try {
    if (!('requestVideoFrameCallback' in video)) throw new Error('Для этого примера нужен браузер с requestVideoFrameCallback.');
    status.textContent = synthetic ? 'Создаём тестовое видео…' : 'Разрешите доступ к камере…';
    const acquired = synthetic ? testStream() : await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    if (ownGeneration !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired; video.srcObject = stream; await video.play();
    if (ownGeneration !== generation) return;
    status.textContent = 'Загружаем модели из /video-analysis/…';
    const loaded = await VideoAnalyzer.create({ assetsBaseUrl: '/video-analysis/' });
    if (ownGeneration !== generation) { loaded.close(); return; }
    analyzer = loaded; loading = false;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (ownGeneration === generation) stop(); }, { once: true });
    status.textContent = synthetic ? 'Модели загружены. Анализируем тестовое видео без лица.' : 'Анализ работает. Следуйте этапам калибровки.';
    callback = video.requestVideoFrameCallback(frame);
    controls();
  } catch (error) {
    if (ownGeneration !== generation) return;
    stop(); status.textContent = error instanceof Error ? error.message : 'Ошибка запуска';
  }
}

document.querySelector('#start')!.addEventListener('click', () => void start(false));
document.querySelector('#test')!.addEventListener('click', () => void start(true));
document.querySelector('#stop')!.addEventListener('click', stop);
document.querySelector('#reset')!.addEventListener('click', () => calibration.reset());
window.addEventListener('orientationchange', () => calibration.reset());
document.addEventListener('visibilitychange', () => { latest = unknown(performance.now()); calibration.reset(); render(); });
window.addEventListener('pagehide', stop);
setInterval(render, 150);
