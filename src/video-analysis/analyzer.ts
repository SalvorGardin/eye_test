import type { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import { observe, unknown } from './vision.ts';
import type { Baseline, Observation } from './vision.ts';

export type VideoAnalyzerOptions = {
  /** Public directory containing models/ and wasm/. For example: '/video-analysis/'. */
  assetsBaseUrl: string;
};

/** Analyzes caller-owned video. Does not acquire a camera, run a loop, or change the DOM. */
export class VideoAnalyzer {
  private face: FaceLandmarker;
  private hand: HandLandmarker;
  private closed = false;
  private lastTimestamp = -Infinity;

  private constructor(face: FaceLandmarker, hand: HandLandmarker) {
    this.face = face; this.hand = hand;
  }

  /** Loads local models, trying GPU first and CPU if initialization fails. */
  static async create(options: VideoAnalyzerOptions): Promise<VideoAnalyzer> {
    if (typeof options?.assetsBaseUrl !== 'string' || !options.assetsBaseUrl.trim()) {
      throw new TypeError('assetsBaseUrl must point to a directory containing models/ and wasm/');
    }
    const base = options.assetsBaseUrl.trim().replace(/\/+$/, '');
    const { FilesetResolver, FaceLandmarker, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    for (const delegate of ['GPU', 'CPU'] as const) {
      let face: FaceLandmarker | null = null, hand: HandLandmarker | null = null;
      try {
        face = await FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${base}/models/face_landmarker.task`, delegate },
          runningMode: 'VIDEO', numFaces: 2,
          minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        });
        hand = await HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${base}/models/hand_landmarker.task`, delegate },
          runningMode: 'VIDEO', numHands: 2,
          minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
        });
        return new VideoAnalyzer(face, hand);
      } catch (error) {
        try { face?.close(); } finally { hand?.close(); }
        if (delegate === 'CPU') throw error;
      }
    }
    throw new Error('No supported inference delegate');
  }

  /**
   * Call once per selected fresh video frame, with strictly increasing performance.now() milliseconds.
   * Pass Calibration.baseline to enable gaze estimation. No baseline means gaze === null.
   * Synchronous inference: the caller controls throttling and handles stale/background frames.
   */
  analyze(video: HTMLVideoElement, timestampMs: number, baseline: Baseline | null = null): Observation {
    if (this.closed) throw new Error('VideoAnalyzer is closed; create a new instance to restart');
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs <= this.lastTimestamp) {
      throw new RangeError('timestampMs must be finite, non-negative and strictly increasing');
    }
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return unknown(timestampMs, 'Видео ещё не готово к анализу');
    }
    this.lastTimestamp = timestampMs;
    const faces = this.face.detectForVideo(video, timestampMs);
    const hands = this.hand.detectForVideo(video, timestampMs);
    return observe(faces.faceLandmarks, hands.landmarks, timestampMs, baseline);
  }

  /** Releases the models once. Never pauses video or stops the caller's MediaStream tracks. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.face.close(); } finally { this.hand.close(); }
  }
}
