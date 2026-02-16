// Client-side audio metrics computation
// Runs in the main thread, batched from AudioWorklet data

export interface AudioMetrics {
  rms: number; // dBFS
  peak: number; // dBFS
  clipCount: number;
  silenceDuration: number; // ms
  speechDetected: boolean;
}

const SILENCE_THRESHOLD = -50; // dBFS
const CLIP_THRESHOLD = 0.99; // normalized sample value

let lastSpeechTime = 0;
let silenceStartTime = 0;

export function computeMetrics(samples: Float32Array): AudioMetrics {
  if (samples.length === 0) {
    return { rms: -Infinity, peak: -Infinity, clipCount: 0, silenceDuration: 0, speechDetected: false };
  }

  let sum = 0;
  let peak = 0;
  let clipCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    sum += samples[i] * samples[i];
    if (abs > peak) peak = abs;
    if (abs >= CLIP_THRESHOLD) clipCount++;
  }

  const rmsLinear = Math.sqrt(sum / samples.length);
  const rmsDb = rmsLinear > 0 ? 20 * Math.log10(rmsLinear) : -Infinity;
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;

  const now = Date.now();
  const speechDetected = rmsDb > SILENCE_THRESHOLD;

  let silenceDuration = 0;
  if (speechDetected) {
    lastSpeechTime = now;
    silenceStartTime = 0;
  } else {
    if (silenceStartTime === 0) {
      silenceStartTime = now;
    }
    silenceDuration = now - silenceStartTime;
  }

  return { rms: rmsDb, peak: peakDb, clipCount, silenceDuration, speechDetected };
}

export function resetMetrics(): void {
  lastSpeechTime = 0;
  silenceStartTime = 0;
}
