/**
 * recorderService.ts — Lossless local audio recording to WAV.
 *
 * Records the user's microphone audio as 48kHz 16-bit PCM WAV, completely
 * independent of the WebRTC connection. While WebRTC streams compressed
 * audio for live monitoring, this service captures uncompressed audio for
 * the dataset — ensuring maximum quality for the processing pipeline.
 *
 * ## Recording Pipeline
 *
 *   MediaStream → AudioContext (48kHz) → AudioWorklet/ScriptProcessor
 *                                              ↓
 *                                     Float32Array chunks
 *                                       ↓              ↓
 *                                   Memory array    IndexedDB
 *                                       ↓              (crash recovery)
 *                                   encodeWAV()
 *                                       ↓
 *                                   Blob (audio/wav)
 *
 * ## AudioWorklet vs ScriptProcessor
 *
 * Prefers AudioWorklet (audio-recorder-worklet.js) which runs on a dedicated
 * audio thread with guaranteed timing. Falls back to ScriptProcessorNode
 * (deprecated but widely supported) if AudioWorklet fails to load.
 *
 * ## IndexedDB Persistence
 *
 * Every chunk is written to IndexedDB (fire-and-forget, non-blocking) so that
 * if the browser crashes mid-recording, the chunks can be recovered and
 * re-encoded into a WAV file on the next session.
 *
 * ## WAV Encoding
 *
 * On stop, all Float32Array chunks are concatenated and encoded into a
 * standard WAV file with:
 *   - RIFF header (44 bytes)
 *   - fmt chunk: PCM, 1 channel, 48kHz, 16-bit
 *   - data chunk: interleaved Int16 samples
 *
 * The WAV header contains the correct file size, so simple uploads work
 * out of the box. For multipart uploads, the server patches bytes 4-7
 * (ChunkSize) and 40-43 (Subchunk2Size) because the client knows the
 * total size at encoding time but the multipart upload API needs them
 * adjusted after Part 1 is cached in a temp location.
 *
 * ## Module State
 *
 * Uses module-level variables instead of React state because:
 * 1. AudioWorklet callbacks need synchronous access to the chunks array
 * 2. Recording state must persist across React renders without re-triggering effects
 * 3. Only one recording can be active at a time (single-instance service)
 */

import { storeChunk, getChunks, clearChunks } from './storageService';

export interface RecorderState {
  isRecording: boolean;
  startedAt: number | null;
  chunks: Float32Array[];
  sampleRate: number;
}

/** AudioContext for the recording pipeline — 48kHz to match the target format */
let audioContext: AudioContext | null = null;

/** Source node connected to the mic MediaStream */
let mediaStreamSource: MediaStreamAudioSourceNode | null = null;

/** AudioWorklet node (preferred) — null if using ScriptProcessor fallback */
let workletNode: AudioWorkletNode | null = null;

/** Session key for IndexedDB persistence — format: roomId:userId:sessionId */
let currentSessionKey: string | null = null;

/** Auto-incrementing index for ordering chunks in IndexedDB */
let chunkIndex = 0;

/** Current recording state */
let state: RecorderState = {
  isRecording: false,
  startedAt: null,
  chunks: [],
  sampleRate: 48000,
};

/**
 * Start recording from the given MediaStream.
 *
 * Sets up the audio pipeline (AudioWorklet preferred, ScriptProcessor fallback)
 * and begins collecting Float32Array chunks in memory + IndexedDB.
 *
 * @param stream — MediaStream from getUserMedia (should have raw audio constraints)
 * @param sessionKey — Identifier for IndexedDB persistence (roomId:userId:sessionId)
 */
export async function startRecording(stream: MediaStream, sessionKey?: string): Promise<void> {
  currentSessionKey = sessionKey || `recording:${Date.now()}`;
  chunkIndex = 0;

  audioContext = new AudioContext({ sampleRate: 48000 });
  state.sampleRate = audioContext.sampleRate;

  mediaStreamSource = audioContext.createMediaStreamSource(stream);

  /**
   * Chunk handler — called for every audio buffer from the worklet/processor.
   * Stores in memory (for encoding) and IndexedDB (for crash recovery).
   */
  const onChunk = (chunk: Float32Array) => {
    state.chunks.push(chunk);
    // Fire-and-forget IndexedDB write — non-blocking to avoid audio glitches
    storeChunk(currentSessionKey!, chunkIndex++, chunk).catch((err) =>
      console.warn('Failed to persist chunk to IndexedDB:', err),
    );
  };

  try {
    // Preferred path: AudioWorklet (dedicated audio thread, guaranteed timing)
    await audioContext.audioWorklet.addModule('/audio-recorder-worklet.js');
    workletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor');

    workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio-data') {
        onChunk(new Float32Array(event.data.buffer));
      }
    };

    mediaStreamSource.connect(workletNode);
    workletNode.connect(audioContext.destination); // Must connect to keep worklet alive
  } catch {
    // Fallback: ScriptProcessorNode (deprecated but widely supported)
    // Runs on the main thread — may drop frames under heavy load
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (state.isRecording) {
        const inputData = event.inputBuffer.getChannelData(0);
        onChunk(new Float32Array(inputData)); // Copy needed — buffer is reused
      }
    };
    mediaStreamSource.connect(processor);
    processor.connect(audioContext.destination);
  }

  state.isRecording = true;
  state.startedAt = Date.now();
  state.chunks = [];
}

/**
 * Stop recording and return the encoded WAV blob.
 *
 * Disconnects all audio nodes, closes the AudioContext, encodes accumulated
 * Float32Array chunks into a WAV file, and clears the IndexedDB backup.
 *
 * @returns WAV Blob (audio/wav, 48kHz 16-bit PCM), or null if no audio was captured
 */
export function stopRecording(): Blob | null {
  state.isRecording = false;

  // Disconnect and clean up audio nodes
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (mediaStreamSource) {
    mediaStreamSource.disconnect();
    mediaStreamSource = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (state.chunks.length === 0) return null;

  // Encode all chunks into a single WAV file
  const wavBlob = encodeWAV(state.chunks, state.sampleRate);
  state.chunks = [];
  state.startedAt = null;

  // Clear IndexedDB backup after successful encoding
  if (currentSessionKey) {
    clearChunks(currentSessionKey).catch(() => {});
    currentSessionKey = null;
  }

  return wavBlob;
}

/**
 * Recover a recording from IndexedDB after a browser crash.
 *
 * Reads all stored Float32Array chunks for the given session key,
 * re-encodes them into a WAV blob, and clears the IndexedDB entries.
 *
 * @param sessionKey — The session key used when startRecording was called
 * @returns WAV Blob, or null if no chunks found
 */
export async function recoverRecording(sessionKey: string): Promise<Blob | null> {
  const chunks = await getChunks(sessionKey);
  if (chunks.length === 0) return null;
  const blob = encodeWAV(chunks, 48000);
  await clearChunks(sessionKey);
  return blob;
}

/** Get a snapshot of the current recording state (for debugging/testing) */
export function getRecorderState(): RecorderState {
  return { ...state };
}

// ─── WAV Encoding ─────────────────────────────────────────────────

/**
 * Encode Float32Array audio chunks into a WAV file.
 *
 * WAV format (RIFF container):
 *   Bytes 0-3:   "RIFF" magic
 *   Bytes 4-7:   ChunkSize = file_size - 8
 *   Bytes 8-11:  "WAVE" format
 *   Bytes 12-15: "fmt " subchunk
 *   Bytes 16-19: Subchunk1Size = 16 (PCM)
 *   Bytes 20-21: AudioFormat = 1 (PCM)
 *   Bytes 22-23: NumChannels = 1 (mono)
 *   Bytes 24-27: SampleRate = 48000
 *   Bytes 28-31: ByteRate = SampleRate × NumChannels × BitsPerSample/8
 *   Bytes 32-33: BlockAlign = NumChannels × BitsPerSample/8
 *   Bytes 34-35: BitsPerSample = 16
 *   Bytes 36-39: "data" subchunk
 *   Bytes 40-43: Subchunk2Size = total_samples × bytes_per_sample
 *   Bytes 44+:   PCM sample data (Int16, little-endian)
 *
 * Note: For multipart uploads, the server patches bytes 4-7 and 40-43
 * with the correct sizes after reassembling all parts.
 */
function encodeWAV(chunks: Float32Array[], sampleRate: number): Blob {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytesPerSample = 2; // 16-bit
  const numChannels = 1;    // Mono
  const dataSize = totalSamples * bytesPerSample;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, headerSize + dataSize - 8, true); // ChunkSize
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                                     // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);                                      // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);                             // NumChannels
  view.setUint32(24, sampleRate, true);                              // SampleRate
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate
  view.setUint16(32, numChannels * bytesPerSample, true);            // BlockAlign
  view.setUint16(34, bytesPerSample * 8, true);                     // BitsPerSample

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Write PCM samples — convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
  let offset = headerSize;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk[i])); // Clamp to valid range
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** Write an ASCII string into a DataView at the given byte offset */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
