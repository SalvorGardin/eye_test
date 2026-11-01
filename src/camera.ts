import { VideoAnalyzer, unknown } from './video-analysis/index.ts';
import type { Baseline, Observation } from './video-analysis/index.ts';

export function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Нет доступа к камере. Разрешите камеру для этого сайта в настройках Safari и повторите запуск.';
  if (name === 'NotFoundError') return 'Камера не найдена. Откройте приложение на устройстве с фронтальной камерой.';
  if (name === 'NotReadableError') return 'Камера занята другим приложением. Закройте его и повторите запуск.';
  return 'Не удалось запустить камеру или загрузить распознавание. Проверьте соединение и повторите запуск.';
}

export class Camera {
  private video: HTMLVideoElement;
  private onObservation: (o: Observation) => void;
  private baseline: () => Baseline | null;
  private onError: (message: string) => void;
  private stream: MediaStream | null = null;
  private analyzer: VideoAnalyzer | null = null;
  private frame = 0;
  private generation = 0;
  private lastVideoTime = -1;
  private lastRun = -Infinity;
  private videoFrame = 0;
  private decodedAt = -Infinity;
  private decodedSerial = 0;
  private processedSerial = 0;
  running = false;

  constructor(video: HTMLVideoElement, onObservation: (o: Observation) => void, baseline: () => Baseline | null, onError: (message: string) => void) {
    this.video = video; this.onObservation = onObservation; this.baseline = baseline; this.onError = onError;
  }

  async start(onProgress: (message: string) => void) {
    this.stop();
    const generation = this.generation;
    const cancelled = () => generation !== this.generation;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Откройте сайт по HTTPS: браузер разрешает камеру только через защищённое соединение (или localhost на компьютере).');
    }
    try {
      onProgress('Разрешите доступ к фронтальной камере');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } });
      if (cancelled()) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.stream = stream; this.video.srcObject = stream;
      await this.video.play();
      if (cancelled()) return false;
      onProgress('Загружаем распознавание на устройство…');
      const analyzer = await VideoAnalyzer.create({ assetsBaseUrl: import.meta.env.BASE_URL });
      if (cancelled()) { analyzer.close(); return false; }
      this.analyzer = analyzer;
      this.running = true;
      if ('requestVideoFrameCallback' in this.video) this.videoFrame = this.video.requestVideoFrameCallback(this.decoded);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (!cancelled()) { this.stop(); this.onError('Камера отключилась. Запустите её заново.'); }
      }, { once: true });
      this.frame = requestAnimationFrame(this.tick);
      return true;
    } catch (error) {
      if (cancelled()) return false;
      this.stop(); throw new Error(cameraError(error));
    }
  }

  private decoded = () => {
    if (!this.running) return;
    this.decodedAt = performance.now(); this.decodedSerial++;
    this.videoFrame = this.video.requestVideoFrameCallback(this.decoded);
  };

  private tick = (now: number) => {
    if (!this.running) return;
    const hasFrameCallback = 'requestVideoFrameCallback' in this.video;
    const newFrame = hasFrameCallback ? this.decodedSerial !== this.processedSerial : this.video.currentTime !== this.lastVideoTime;
    // ponytail: capped synchronous inference is enough for a demo; move to a worker if real-device latency requires it.
    if (!document.hidden && now - this.lastRun >= 100 && this.video.readyState >= 2 && newFrame && !this.stream?.getVideoTracks()[0]?.muted) {
      this.lastRun = now; this.lastVideoTime = this.video.currentTime;
      this.processedSerial = this.decodedSerial;
      try {
        this.onObservation(this.analyzer!.analyze(this.video, hasFrameCallback ? this.decodedAt : now, this.baseline()));
      } catch {
        this.stop(); this.onError('Распознавание прервалось. Повторите запуск камеры.'); return;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  stop() {
    this.generation++; this.running = false;
    cancelAnimationFrame(this.frame);
    if ('cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.videoFrame);
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null;
    this.analyzer?.close(); this.analyzer = null;
    this.lastVideoTime = -1; this.lastRun = -Infinity;
    this.decodedAt = -Infinity; this.decodedSerial = 0; this.processedSerial = 0;
    this.onObservation(unknown(performance.now(), 'Камера выключена'));
  }
}
