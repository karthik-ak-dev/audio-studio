/**
 * spectralService.ts — Client-side frequency-domain audio analysis.
 *
 * Analyzes the frequency spectrum from AnalyserNode.getFloatFrequencyData()
 * to detect speech characteristics, electrical hum, muffled audio, and
 * distinguish real speech from ambient noise.
 *
 * Used by useAudioMetrics hook during the green room mic check phase.
 *
 * ## Metrics Computed
 *
 * - **voiceBandEnergy** — Fraction of total energy in 300Hz–3.4kHz (human voice range).
 *   High (>0.4) when someone is speaking, low when only noise or silence.
 *
 * - **highFreqEnergy** — Fraction of total energy above 2kHz.
 *   Low values (<0.05) indicate muffled audio (blocked mic, poor positioning).
 *
 * - **spectralFlatness** — Wiener entropy: geometric mean / arithmetic mean of spectrum.
 *   0 = purely tonal (like a sine wave or speech), 1 = perfectly flat (white noise).
 *   Speech typically has flatness < 0.7, pure noise is closer to 1.
 *
 * - **humDetected** — True if energy at 50Hz or 60Hz is significantly higher than
 *   surrounding bins, indicating electrical interference or ground loop hum.
 *
 * - **speechLikely** — Combined check: voice band dominant + low spectral flatness.
 *   More reliable than simple RMS thresholding, which can't distinguish a fan from speech.
 */

import { AUDIO_THRESHOLDS } from '../shared';

export interface SpectralMetrics {
  voiceBandEnergy: number;
  highFreqEnergy: number;
  spectralFlatness: number;
  humDetected: boolean;
  speechLikely: boolean;
}

/** Convert a frequency in Hz to the nearest FFT bin index */
function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
  return Math.round(hz * fftSize / sampleRate);
}

/**
 * Compute spectral metrics from frequency-domain data.
 *
 * @param freqData — Float32Array from AnalyserNode.getFloatFrequencyData().
 *                   Values are in dB (typically -100 to 0 dBFS).
 * @param sampleRate — AudioContext sample rate (48000)
 * @param fftSize — AnalyserNode fftSize (2048)
 */
export function computeSpectralMetrics(
  freqData: Float32Array,
  sampleRate: number,
  fftSize: number,
): SpectralMetrics {
  const numBins = freqData.length; // fftSize / 2

  // Convert dB to linear power for energy calculations
  const linearPower = new Float32Array(numBins);
  let totalEnergy = 0;

  for (let i = 0; i < numBins; i++) {
    const power = Math.pow(10, freqData[i] / 10);
    linearPower[i] = power;
    totalEnergy += power;
  }

  if (totalEnergy === 0) {
    return { voiceBandEnergy: 0, highFreqEnergy: 0, spectralFlatness: 1, humDetected: false, speechLikely: false };
  }

  // Voice band energy: 300Hz to 3400Hz
  const voiceLowBin = hzToBin(300, sampleRate, fftSize);
  const voiceHighBin = hzToBin(3400, sampleRate, fftSize);
  let voiceEnergy = 0;
  for (let i = voiceLowBin; i <= voiceHighBin && i < numBins; i++) {
    voiceEnergy += linearPower[i];
  }
  const voiceBandEnergy = voiceEnergy / totalEnergy;

  // High frequency energy: above 2kHz
  const highFreqBin = hzToBin(2000, sampleRate, fftSize);
  let highEnergy = 0;
  for (let i = highFreqBin; i < numBins; i++) {
    highEnergy += linearPower[i];
  }
  const highFreqEnergy = highEnergy / totalEnergy;

  // Spectral flatness (Wiener entropy): geometric mean / arithmetic mean
  // Computed in log domain for numerical stability
  let logSum = 0;
  let linSum = 0;
  let count = 0;
  for (let i = 1; i < numBins; i++) { // Skip DC bin
    if (linearPower[i] > 0) {
      logSum += Math.log(linearPower[i]);
      linSum += linearPower[i];
      count++;
    }
  }
  const spectralFlatness = count > 0
    ? Math.exp(logSum / count) / (linSum / count)
    : 1;

  // Hum detection: check 50Hz and 60Hz bins against neighbors
  const humDetected = detectHum(linearPower, sampleRate, fftSize);

  // Speech likely: voice band dominant + low spectral flatness
  const speechLikely =
    voiceBandEnergy > AUDIO_THRESHOLDS.VOICE_BAND_ENERGY_MIN &&
    spectralFlatness < AUDIO_THRESHOLDS.SPECTRAL_FLATNESS_MAX;

  return { voiceBandEnergy, highFreqEnergy, spectralFlatness, humDetected, speechLikely };
}

/**
 * Detect electrical hum at 50Hz (EU mains) or 60Hz (US mains).
 * Compares energy at the hum frequency bin against the average of neighboring bins.
 */
function detectHum(
  linearPower: Float32Array,
  sampleRate: number,
  fftSize: number,
): boolean {
  for (const humFreq of [50, 60]) {
    const bin = hzToBin(humFreq, sampleRate, fftSize);
    if (bin < 2 || bin >= linearPower.length - 2) continue;

    const humPower = linearPower[bin];
    const neighborAvg = (
      linearPower[bin - 2] + linearPower[bin - 1] +
      linearPower[bin + 1] + linearPower[bin + 2]
    ) / 4;

    if (neighborAvg > 0 && humPower / neighborAvg > AUDIO_THRESHOLDS.HUM_DETECTION_RATIO) {
      return true;
    }
  }
  return false;
}
