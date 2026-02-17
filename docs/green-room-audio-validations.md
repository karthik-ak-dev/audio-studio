# Green Room Audio Validations — Comprehensive Reference

> Pre-recording microphone quality evaluation system.
> All checks run during the green room (sound check) phase before a participant enters the recording studio.

---

## Architecture Overview

```
┌─────────────────────── CLIENT (Browser) ───────────────────────┐
│                                                                 │
│  MediaStream (48kHz)                                            │
│       │                                                         │
│       ▼                                                         │
│  AnalyserNode (fftSize: 2048)                                   │
│       │                                                         │
│       ├─── getFloatTimeDomainData() ──► metricsService.ts        │
│       │    (2048 float samples)         → RMS, Peak, ClipCount, │
│       │                                   SilenceDuration,      │
│       │                                   SpeechDetected,       │
│       │                                   RmsStability          │
│       │                                                         │
│       └─── getFloatFrequencyData() ──► spectralService.ts       │
│            (1024 frequency bins)        → VoiceBandEnergy,      │
│                                           HighFreqEnergy,       │
│                                           SpectralFlatness,     │
│                                           HumDetected,          │
│                                           SpeechLikely          │
│                                                                 │
│  useAudioMetrics hook (rAF loop ~60fps)                         │
│       │                                                         │
│       ▼                                                         │
│  EMA Smoothing (attack α=0.3, release α=0.08)                  │
│       │                                                         │
│       ▼                                                         │
│  GreenRoom.tsx emits MIC_CHECK every 1 second ──────────────────┤
│       │                                                         │
└───────┼─────────────────────────────────────────────────────────┘
        │ Socket.IO
        ▼
┌─────────────────────── SERVER ─────────────────────────────────┐
│                                                                 │
│  socket/greenRoom.ts                                            │
│       │                                                         │
│       ▼                                                         │
│  greenRoomService.evaluate(metrics) ──► MicStatus               │
│       │                                                         │
│       ├── Volume level (RMS thresholds)                         │
│       ├── Noise floor classification                            │
│       ├── Clipping detection                                    │
│       ├── SNR computation & classification                      │
│       ├── Speech verification (spectral)                        │
│       ├── Signal stability check                                │
│       ├── Spectral warnings (muffled/hum/noise-like)            │
│       └── Suggestion builder                                    │
│                                                                 │
│  Returns MicStatus via MIC_STATUS event ────────────────────────┤
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase Flow (UX)

The green room has 3 sequential phases. No new user-facing steps — each phase is enhanced with smarter checks.

| Phase | Step | What's Checked | Blocking? | Pass Criteria |
|-------|------|----------------|-----------|---------------|
| **1. Device** | Select microphone | Stream acquisition | Yes | MediaStream obtained |
| **2. Level** | Speak into mic | Volume + Speech verification | Yes | 2 of 6 frames have `level === 'good' && speechVerified` |
| **3. Environment** | Stay quiet | Noise floor + SNR + Spectral | Yes/Advisory | `noiseFloor !== 'unacceptable' && snr !== 'blocking'` |
| **Ready** | Enter studio | — | — | All phases passed |

---

## Metrics Reference Table

### 1. RMS (Root Mean Square)

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Average loudness of the audio signal |
| **Unit** | dBFS (decibels relative to full scale). 0 = digital max, -60 = near silence |
| **Data source** | `AnalyserNode.getFloatTimeDomainData()` — 2048 float samples per frame |
| **Collection frequency** | ~60fps (requestAnimationFrame), sent to server every 1 second |
| **Computation** | `20 × log10(√(Σ(s²) / N))` where s = each sample, N = 2048 |
| **Code location** | `web/src/services/metricsService.ts` → `computeMetrics()` |
| **Sent to server as** | `MIC_CHECK.rms` (raw dBFS value, not EMA-smoothed) |
| **Server validation** | Compared against `MIC_TOO_QUIET` and `MIC_TOO_LOUD` thresholds |
| **Thresholds** | Too quiet: < **-40 dBFS** · Too loud: > **-6 dBFS** · Sweet spot: -26 to -20 dBFS |
| **Classification** | `'good'` · `'too-quiet'` · `'too-loud'` |
| **Why it matters** | Too quiet = unusable transcription; too loud = distortion risk. Matches broadcast target of -23 LUFS |

---

### 2. Peak Level

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Highest instantaneous sample amplitude in the analysis frame |
| **Unit** | dBFS |
| **Data source** | Same `getFloatTimeDomainData()` buffer as RMS |
| **Collection frequency** | ~60fps, sent every 1 second |
| **Computation** | `20 × log10(max(|s₁|, |s₂|, ..., |sₙ|))` |
| **Code location** | `web/src/services/metricsService.ts` → `computeMetrics()` |
| **Sent to server as** | `MIC_CHECK.peak` |
| **Server use** | Used for display; clipping is detected separately via clip count |
| **Good value** | -12 to -3 dBFS (headroom without being too quiet) |
| **Bad value** | 0 dBFS or above (digital clipping) |

---

### 3. Clipping Detection

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Number of samples exceeding normalized amplitude of 0.99 |
| **Unit** | Count per frame |
| **Data source** | Same `getFloatTimeDomainData()` buffer |
| **Collection frequency** | ~60fps, sent every 1 second as boolean |
| **Computation** | Count samples where `|sample| ≥ 0.99` |
| **Code location** | `web/src/services/metricsService.ts` → `computeMetrics()` |
| **Sent to server as** | `MIC_CHECK.isClipping` (boolean: `clipCount > 0`) |
| **Server validation** | Direct boolean check in `evaluate()` |
| **Good value** | `false` (0 clipped samples) |
| **Bad value** | `true` (any clipped samples — causes permanent distortion) |
| **Why it matters** | Clipped audio is permanently distorted and cannot be recovered in post-processing |

---

### 4. Noise Floor

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Ambient background noise level when the user is not speaking |
| **Unit** | dBFS |
| **Data source** | Client-side EMA estimate from quiet frames (RMS < -35 dBFS) |
| **Computation** | `noiseFloor = prev + 0.1 × (rms - prev)` on frames where RMS < -35 dBFS |
| **Code location** | `web/src/pages/GreenRoom.tsx` → `noiseFloorRef` useEffect |
| **Sent to server as** | `MIC_CHECK.noiseFloor` |
| **Server validation** | Compared against `NOISE_FLOOR_NOISY` and `NOISE_FLOOR_REJECT` |
| **Thresholds** | Clean: < **-45 dBFS** · Noisy: -45 to **-30 dBFS** · Unacceptable: > **-30 dBFS** |
| **Classification** | `'clean'` · `'noisy'` · `'unacceptable'` |
| **Why it matters** | High noise floor degrades SNR and makes post-processing difficult; -30 dBFS noise is audible in any recording |

---

### 5. Signal-to-Noise Ratio (SNR)

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Gap between speech level and background noise |
| **Unit** | dB |
| **Data source** | Derived: `rms - noiseFloor` (both from client metrics) |
| **Computation** | `snrValue = metrics.rms - metrics.noiseFloor` (server-side) |
| **Code location** | `server/src/services/greenRoomService.ts` → `evaluate()` |
| **Server validation** | Classified into 4 tiers based on SNR value |
| **Thresholds** | Blocking: < **10 dB** · Poor: 10–15 dB · Fair: 15–20 dB · Good: ≥ **20 dB** |
| **Classification** | `'good'` · `'fair'` · `'poor'` · `'blocking'` |
| **Blocking?** | Yes — `'blocking'` prevents entering the studio |
| **Why it matters** | Aligns with quality profile tiers: SNR < 10 dB = P4 "Reject" in the processing pipeline. Catching this pre-recording saves pipeline costs and participant time |

---

### 6. Voice Band Energy

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Fraction of total audio energy in the human voice frequency range (300 Hz – 3.4 kHz) |
| **Unit** | Ratio (0 to 1) |
| **Data source** | `AnalyserNode.getFloatFrequencyData()` — 1024 frequency bins, each ~23.4 Hz wide |
| **Computation** | Sum of linear power in bins 300–3400 Hz ÷ total linear power across all bins |
| **Code location** | `web/src/services/spectralService.ts` → `computeSpectralMetrics()` |
| **Sent to server as** | `MIC_CHECK.voiceBandEnergy` |
| **Server use** | Combined with spectral flatness for `speechLikely` determination |
| **Threshold** | Min: **0.4** (below this = not speech-like) |
| **Good value** | > 0.4 (most energy in voice band = likely speech) |
| **Bad value** | < 0.4 (energy spread elsewhere = fan, AC, or wrong device) |

---

### 7. High Frequency Energy

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Fraction of total energy above 2 kHz — presence of high-frequency content |
| **Unit** | Ratio (0 to 1) |
| **Data source** | Same `getFloatFrequencyData()` as voice band energy |
| **Computation** | Sum of linear power in bins above 2 kHz ÷ total linear power |
| **Code location** | `web/src/services/spectralService.ts` → `computeSpectralMetrics()` |
| **Sent to server as** | `MIC_CHECK.highFreqEnergy` |
| **Server validation** | If < `HIGH_FREQ_ENERGY_MIN` and `speechLikely` → `'muffled'` warning |
| **Threshold** | Min: **0.05** |
| **Good value** | ≥ 0.05 (natural speech has sibilance and harmonics above 2 kHz) |
| **Bad value** | < 0.05 (mic covered, foam too thick, or positioned behind barrier) |

---

### 8. Spectral Flatness (Wiener Entropy)

| Attribute | Detail |
|-----------|--------|
| **What it measures** | How "noise-like" vs "tonal" the signal is |
| **Unit** | Ratio (0 to 1). 0 = purely tonal (sine wave), 1 = perfectly flat (white noise) |
| **Data source** | Same `getFloatFrequencyData()` frequency bins |
| **Computation** | `geometric_mean(power) / arithmetic_mean(power)` — computed in log domain for stability |
| **Code location** | `web/src/services/spectralService.ts` → `computeSpectralMetrics()` |
| **Sent to server as** | `MIC_CHECK.spectralFlatness` |
| **Server validation** | If > `SPECTRAL_FLATNESS_MAX` and RMS > `MIC_TOO_QUIET` → `'noise-like'` warning |
| **Threshold** | Max: **0.7** |
| **Good value** | < 0.7 (speech has harmonic structure, creating low flatness) |
| **Bad value** | > 0.7 (signal resembles noise — wrong device, broken mic, or heavy interference) |

---

### 9. Hum Detection

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Electrical interference from mains power (50 Hz EU / 60 Hz US) |
| **Unit** | Boolean |
| **Data source** | Same `getFloatFrequencyData()` frequency bins |
| **Computation** | Compare energy at 50 Hz and 60 Hz bins against average of 4 neighboring bins. If ratio > threshold → hum detected |
| **Code location** | `web/src/services/spectralService.ts` → `detectHum()` |
| **Sent to server as** | `MIC_CHECK.humDetected` |
| **Server validation** | If `true` → `'hum-detected'` spectral warning |
| **Threshold** | Ratio > **10×** neighbors |
| **Good value** | `false` (no concentrated energy at mains frequencies) |
| **Bad value** | `true` (ground loop, cheap USB adapter, or proximity to power lines) |
| **Blocking?** | No — advisory warning only |

---

### 10. RMS Stability

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Consistency of the audio signal level over time |
| **Unit** | Standard deviation of RMS values (dB) |
| **Data source** | Rolling window of 30 RMS values from `computeMetrics()` (~0.5 seconds at 60fps) |
| **Computation** | `stddev(rmsHistory)` — standard deviation of last 30 RMS readings |
| **Code location** | `web/src/services/metricsService.ts` → `computeRmsStability()` |
| **Sent to server as** | `MIC_CHECK.rmsStability` |
| **Server validation** | If > `RMS_STABILITY_MAX_STDDEV` → `'unstable'` stability classification |
| **Threshold** | Max: **6 dB** stddev |
| **Good value** | < 6 dB (steady, consistent signal) |
| **Bad value** | > 6 dB (intermittent dropouts, loose cable, Bluetooth interference) |
| **Blocking?** | No — advisory warning only |

---

### 11. Speech Verification (Composite VAD)

| Attribute | Detail |
|-----------|--------|
| **What it measures** | Whether the audio actually contains human speech (not just noise passing RMS threshold) |
| **Unit** | Boolean |
| **Data source** | Composite of voice band energy + spectral flatness |
| **Computation** | `speechLikely = voiceBandEnergy > 0.4 AND spectralFlatness < 0.7` (client) · `speechVerified = speechLikely AND level !== 'too-quiet'` (server) |
| **Code location** | Client: `spectralService.ts` · Server: `greenRoomService.ts` |
| **Sent to server as** | `MIC_CHECK.speechLikely` |
| **Server output** | `MicStatus.speechVerified` |
| **Blocking?** | Yes — level check requires `speechVerified === true` to count as a "good" frame |
| **Why it matters** | Prevents non-speech audio (fans, AC, traffic) from passing the level check. A fan at -25 dBFS would pass the RMS check but fail speech verification |

---

## Threshold Summary Table

| Threshold Constant | Value | Unit | Used By |
|--------------------|-------|------|---------|
| `MIC_TOO_QUIET` | -40 | dBFS | Volume level check |
| `MIC_TOO_LOUD` | -6 | dBFS | Volume level check |
| `NOISE_FLOOR_GOOD` | -45 | dBFS | Noise floor classification |
| `NOISE_FLOOR_NOISY` | -35 | dBFS | Noise floor classification |
| `NOISE_FLOOR_REJECT` | -30 | dBFS | Noise floor classification |
| `GREEN_ROOM_SNR_BLOCK` | 10 | dB | SNR — blocks recording |
| `GREEN_ROOM_SNR_WARN` | 15 | dB | SNR — poor warning |
| `GREEN_ROOM_SNR_GOOD` | 20 | dB | SNR — good threshold |
| `VOICE_BAND_ENERGY_MIN` | 0.4 | ratio | Speech detection |
| `SPECTRAL_FLATNESS_MAX` | 0.7 | ratio | Speech/noise discrimination |
| `HUM_DETECTION_RATIO` | 10 | ratio | Hum detection |
| `RMS_STABILITY_MAX_STDDEV` | 6 | dB | Signal stability |
| `HIGH_FREQ_ENERGY_MIN` | 0.05 | ratio | Muffled audio detection |

---

## Server Response — MicStatus

The server returns a `MicStatus` object for every `MIC_CHECK` event:

```typescript
interface MicStatus {
  level: 'good' | 'too-quiet' | 'too-loud';
  noiseFloor: 'clean' | 'noisy' | 'unacceptable';
  clipping: boolean;
  snr: 'good' | 'fair' | 'poor' | 'blocking';
  snrValue: number;
  speechVerified: boolean;
  stability: 'stable' | 'unstable';
  spectralWarnings: ('muffled' | 'hum-detected' | 'noise-like')[];
  suggestions: string[];
}
```

---

## Suggestions Generated

| Condition | Suggestion Text |
|-----------|----------------|
| Level = too-quiet | "Move closer to your microphone or increase input gain" |
| Level = too-loud | "Move away from your microphone or reduce input gain" |
| Clipping = true | "Your audio is clipping — reduce volume to prevent distortion" |
| Noise floor = noisy | "Background noise detected — try a quieter room or use a noise-isolating mic" |
| Noise floor = unacceptable | "Too much background noise — recording quality will be poor. Please move to a quieter space" |
| SNR = blocking | "Signal-to-noise ratio is too low for recording — reduce background noise or move closer to the microphone" |
| SNR = poor | "Signal-to-noise ratio is marginal — consider reducing background noise" |
| Stability = unstable | "Audio signal is unstable — check your cable connection or try a different USB port" |
| Muffled warning | "Audio sounds muffled — check that nothing is covering your microphone" |
| Hum detected | "Electrical hum detected — try a different USB port or move away from power sources" |
| Noise-like signal | "Signal sounds like noise rather than speech — check your microphone selection" |
| All checks pass | "Audio levels look good!" |

---

## Key File Locations

| File | Purpose |
|------|---------|
| `web/src/services/metricsService.ts` | Time-domain metrics: RMS, peak, clip count, silence, stability |
| `web/src/services/spectralService.ts` | Frequency-domain metrics: voice band, high freq, flatness, hum, speech detection |
| `web/src/hooks/useAudioMetrics.ts` | React hook: Web Audio pipeline, rAF loop, EMA smoothing |
| `web/src/pages/GreenRoom.tsx` | UI: 3-phase sound check, evidence accumulation, phase transitions |
| `web/src/shared/constants/thresholds.ts` | All threshold constants (client copy) |
| `server/src/shared/constants/thresholds.ts` | All threshold constants (server copy — must stay in sync) |
| `server/src/services/greenRoomService.ts` | Server-side evaluation: classify metrics → MicStatus |
| `server/src/socket/greenRoom.ts` | Socket handler: receive MIC_CHECK, call evaluate, emit MIC_STATUS |
| `web/src/shared/types/metrics.ts` | Shared types: MicCheckMetrics, MicStatus, SpectralWarning |

---

## Backward Compatibility

The server applies safe defaults for all new fields when receiving data from older clients:

```typescript
voiceBandEnergy: data.voiceBandEnergy ?? 0,     // → speechLikely = false
highFreqEnergy: data.highFreqEnergy ?? 0,        // → no muffled warning
spectralFlatness: data.spectralFlatness ?? 1,    // → noise-like (safe default)
humDetected: data.humDetected ?? false,           // → no hum warning
rmsStability: data.rmsStability ?? 0,             // → stable
speechLikely: data.speechLikely ?? false,         // → speechVerified = false
```
