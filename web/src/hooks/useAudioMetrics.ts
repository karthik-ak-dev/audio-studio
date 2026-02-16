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
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  const startMetrics = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    contextRef.current = ctx;
    analyserRef.current = analyser;
    resetMetrics();

    const buffer = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);
      const m = computeMetrics(buffer);
      setMetrics(m);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

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

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      contextRef.current?.close();
    };
  }, []);

  return { metrics, startMetrics, stopMetrics };
}
