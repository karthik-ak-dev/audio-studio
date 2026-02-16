/**
 * useAudioMetrics.ts — Real-time audio level analysis hook.
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
 * 3. The computed metrics (RMS dBFS, peak dBFS, clip count, silence
 *    duration, speech detection) are stored in React state for rendering.
 *
 * 4. `stopMetrics()` tears down the audio pipeline and cancels the rAF loop.
 *
 * ## Audio Pipeline
 *
 *   AudioContext (48kHz) → MediaStreamSource → AnalyserNode (FFT 2048)
 *                                                    ↓
 *                                          getFloatTimeDomainData()
 *                                                    ↓
 *                                            computeMetrics(samples)
 *                                                    ↓
 *                                        { rms, peak, clipCount, ... }
 *
 * ## Why 48kHz?
 *
 * Matches the recording pipeline sample rate. If the AudioContext ran at
 * a different rate, the AnalyserNode would resample, and the metrics
 * (especially clip detection) could differ from the actual recording.
 *
 * ## Cleanup
 *
 * The useEffect cleanup closes the AudioContext and cancels rAF on unmount,
 * preventing memory leaks from orphaned audio nodes.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { computeMetrics, resetMetrics } from '@/services/metricsService';
import type { AudioMetrics } from '@/services/metricsService';

export interface UseAudioMetricsReturn {
  metrics: AudioMetrics | null;
  startMetrics: (stream: MediaStream) => void;
  stopMetrics: () => void;
}

export function useAudioMetrics(): UseAudioMetricsReturn {
  const [metrics, setMetrics] = useState<AudioMetrics | null>(null);

  /** Web Audio context — 48kHz to match recording pipeline */
  const contextRef = useRef<AudioContext | null>(null);

  /** AnalyserNode for reading time-domain audio data */
  const analyserRef = useRef<AnalyserNode | null>(null);

  /** requestAnimationFrame handle for the metrics loop */
  const rafRef = useRef<number>(0);

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
    resetMetrics(); // Clear silence/speech tracking state

    const buffer = new Float32Array(analyser.fftSize);

    /** rAF loop — runs at display refresh rate (~60fps) */
    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);
      const m = computeMetrics(buffer);
      setMetrics(m);
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
