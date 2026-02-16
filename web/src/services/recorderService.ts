// Records local microphone audio to WAV (48kHz 16-bit PCM)
// Separate from WebRTC — this captures lossless audio for the dataset

import { storeChunk, getChunks, clearChunks } from './storageService';

export interface RecorderState {
  isRecording: boolean;
  startedAt: number | null;
  chunks: Float32Array[];
  sampleRate: number;
}

let audioContext: AudioContext | null = null;
let mediaStreamSource: MediaStreamAudioSourceNode | null = null;
let workletNode: AudioWorkletNode | null = null;
let currentSessionKey: string | null = null;
let chunkIndex = 0;
let state: RecorderState = {
  isRecording: false,
  startedAt: null,
  chunks: [],
  sampleRate: 48000,
};

export async function startRecording(stream: MediaStream, sessionKey?: string): Promise<void> {
  currentSessionKey = sessionKey || `recording:${Date.now()}`;
  chunkIndex = 0;

  audioContext = new AudioContext({ sampleRate: 48000 });
  state.sampleRate = audioContext.sampleRate;

  // Use ScriptProcessor as fallback if AudioWorklet isn't available
  mediaStreamSource = audioContext.createMediaStreamSource(stream);

  const onChunk = (chunk: Float32Array) => {
    state.chunks.push(chunk);
    // Fire-and-forget IndexedDB write (non-blocking)
    storeChunk(currentSessionKey!, chunkIndex++, chunk).catch((err) =>
      console.warn('Failed to persist chunk to IndexedDB:', err),
    );
  };

  try {
    await audioContext.audioWorklet.addModule('/audio-recorder-worklet.js');
    workletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor');

    workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio-data') {
        onChunk(new Float32Array(event.data.buffer));
      }
    };

    mediaStreamSource.connect(workletNode);
    workletNode.connect(audioContext.destination); // Needed to keep the worklet alive
  } catch {
    // Fallback: use ScriptProcessorNode (deprecated but widely supported)
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (state.isRecording) {
        const inputData = event.inputBuffer.getChannelData(0);
        onChunk(new Float32Array(inputData));
      }
    };
    mediaStreamSource.connect(processor);
    processor.connect(audioContext.destination);
  }

  state.isRecording = true;
  state.startedAt = Date.now();
  state.chunks = [];
}

export function stopRecording(): Blob | null {
  state.isRecording = false;

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

  const wavBlob = encodeWAV(state.chunks, state.sampleRate);
  state.chunks = [];
  state.startedAt = null;

  // Clear persisted chunks after successful encoding
  if (currentSessionKey) {
    clearChunks(currentSessionKey).catch(() => {});
    currentSessionKey = null;
  }

  return wavBlob;
}

export async function recoverRecording(sessionKey: string): Promise<Blob | null> {
  const chunks = await getChunks(sessionKey);
  if (chunks.length === 0) return null;
  const blob = encodeWAV(chunks, 48000);
  await clearChunks(sessionKey);
  return blob;
}

export function getRecorderState(): RecorderState {
  return { ...state };
}

// ─── WAV Encoding ─────────────────────────────────────────────────

function encodeWAV(chunks: Float32Array[], sampleRate: number): Blob {
  // Calculate total samples
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytesPerSample = 2; // 16-bit
  const numChannels = 1;
  const dataSize = totalSamples * bytesPerSample;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, headerSize + dataSize - 8, true); // ChunkSize
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate
  view.setUint16(32, numChannels * bytesPerSample, true); // BlockAlign
  view.setUint16(34, bytesPerSample * 8, true); // BitsPerSample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Write PCM samples (float32 → int16)
  let offset = headerSize;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
