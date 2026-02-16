// AudioWorklet processor — runs in a separate thread
// Captures raw PCM samples and posts them to the main thread

class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 4096;
    this._buffer = new Float32Array(this._bufferSize);
    this._writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0]; // Mono (channel 0)
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i++) {
      this._buffer[this._writeIndex] = channelData[i];
      this._writeIndex++;

      if (this._writeIndex >= this._bufferSize) {
        // Send buffer to main thread
        this.port.postMessage({
          type: 'audio-data',
          buffer: this._buffer.buffer.slice(0),
        });
        this._buffer = new Float32Array(this._bufferSize);
        this._writeIndex = 0;
      }
    }

    return true; // Keep processing
  }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
