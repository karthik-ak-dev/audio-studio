/**
 * useAudioMetrics.ts — Real-time audio level analysis hook with EMA smoothing.
 *
 * Provides live RMS, peak, clipping, silence, and speech detection metrics
 * from a MediaStream. Used in both the GreenRoom (mic check) and Studio
 * (recording monitoring).
 *
 * ## How it works
 *
 * 1. `startMetrics(stream)` creates a Web Audio pipeline:
 *    MediaStream → MediaStreamSource → AnalyserNode
 *
 * 2. A `requestAnimationFrame` loop (~60fps) reads time-domain samples
 *    from the AnalyserNode and passes them to `computeMetrics()` from
 *    metricsService.
 *
 * 3. Raw metrics are smoothed using Exponential Moving Average (EMA)
 *    to prevent visual jitter while preserving responsiveness.
 *
 * 4. `stopMetrics()` tears down the audio pipeline and cancels the rAF loop.
 *
 * ## EMA Smoothing
 *
 * Raw dBFS values jump drastically frame-to-frame (e.g. -45 → -20 → -38).
 * We apply separate EMA coefficients for attack (fast rise) and release
 * (slow decay), mimicking professional VU/PPM meters:
 *   - Attack α = 0.3 (fast response to level increases)
 *   - Release α = 0.08 (slow decay for readable display)
 *   - Peak uses separate slow-decay with hold for transient visibility
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { computeMetrics, resetMetrics } from '@/services/metricsService';
import { computeSpectralMetrics } from '@/services/spectralService';
import type { AudioMetrics } from '@/services/metricsService';
import type { SpectralMetrics } from '@/services/spectralService';

export interface SmoothedAudioMetrics extends AudioMetrics, SpectralMetrics {
  /** EMA-smoothed RMS in dBFS — use this for visual display */
  smoothRms: number;
  /** Slow-decaying peak in dBFS — use this for peak hold indicator */
  smoothPeak: number;
}

export interface UseAudioMetricsReturn {
  metrics: SmoothedAudioMetrics | null;
  startMetrics: (stream: MediaStream) => void;
  stopMetrics: () => void;
}

/** EMA coefficient for rising levels (fast attack) */
const ATTACK_ALPHA = 0.3;
/** EMA coefficient for falling levels (slow release) */
const RELEASE_ALPHA = 0.08;
/** EMA coefficient for peak decay (very slow for peak hold effect) */
const PEAK_RELEASE_ALPHA = 0.05;

export function useAudioMetrics(): UseAudioMetricsReturn {
  const [metrics, setMetrics] = useState<SmoothedAudioMetrics | null>(null);

  /** Web Audio context — 48kHz to match recording pipeline */
  const contextRef = useRef<AudioContext | null>(null);

  /** AnalyserNode for reading time-domain audio data */
  const analyserRef = useRef<AnalyserNode | null>(null);

  /** requestAnimationFrame handle for the metrics loop */
  const rafRef = useRef<number>(0);

  /** Smoothed values persisted across frames */
  const smoothRef = useRef({ rms: -60, peak: -60 });

  /**
   * Start the metrics pipeline.
   * Creates AudioContext → MediaStreamSource → AnalyserNode,
   * then begins the rAF loop to compute metrics every frame.
   */
  const startMetrics = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; // 2048 samples per analysis frame
    source.connect(analyser);

    contextRef.current = ctx;
    analyserRef.current = analyser;
    smoothRef.current = { rms: -60, peak: -60 };
    resetMetrics(); // Clear silence/speech tracking state

    const buffer = new Float32Array(analyser.fftSize);
    const freqBuffer = new Float32Array(analyser.frequencyBinCount);

    /** rAF loop — runs at display refresh rate (~60fps) */
    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);
      const raw = computeMetrics(buffer);

      // Frequency-domain analysis for spectral metrics
      analyser.getFloatFrequencyData(freqBuffer);
      const spectral = computeSpectralMetrics(freqBuffer, ctx.sampleRate, analyser.fftSize);

      // Clamp raw values to usable range for smoothing
      const rawRms = Math.max(-60, raw.rms === -Infinity ? -60 : raw.rms);
      const rawPeak = Math.max(-60, raw.peak === -Infinity ? -60 : raw.peak);

      const prev = smoothRef.current;

      // EMA with separate attack/release coefficients
      const rmsAlpha = rawRms > prev.rms ? ATTACK_ALPHA : RELEASE_ALPHA;
      const smoothRms = prev.rms + rmsAlpha * (rawRms - prev.rms);

      // Peak: fast attack, very slow release (peak hold effect)
      const peakAlpha = rawPeak > prev.peak ? ATTACK_ALPHA : PEAK_RELEASE_ALPHA;
      const smoothPeak = prev.peak + peakAlpha * (rawPeak - prev.peak);

      smoothRef.current = { rms: smoothRms, peak: smoothPeak };

      setMetrics({
        ...raw,
        ...spectral,
        smoothRms,
        smoothPeak,
      });

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * Stop the metrics pipeline.
   * Cancels the rAF loop, closes the AudioContext, and resets state.
   */
  const stopMetrics = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    contextRef.current?.close();
    contextRef.current = null;
    analyserRef.current = null;
    setMetrics(null);
    resetMetrics();
  }, []);

  /** Safety cleanup on unmount — prevent orphaned audio nodes */
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      contextRef.current?.close();
    };
  }, []);

  return { metrics, startMetrics, stopMetrics };
}
