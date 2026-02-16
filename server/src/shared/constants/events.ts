export const SOCKET_EVENTS = {
  JOIN_ROOM: 'join-room',
  ROOM_STATE: 'room-state',
  USER_JOINED: 'user-joined',
  USER_LEFT: 'user-left',
  PEER_RECONNECTED: 'peer-reconnected',
  ROOM_FULL: 'room-full',
  DUPLICATE_SESSION: 'duplicate-session',

  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',

  START_RECORDING: 'start-recording',
  STOP_RECORDING: 'stop-recording',
  RESUME_RECORDING: 'resume-recording',

  CHAT_MESSAGE: 'chat-message',

  MIC_CHECK: 'mic-check',
  MIC_STATUS: 'mic-status',

  AUDIO_METRICS: 'audio-metrics',
  RECORDING_WARNING: 'recording-warning',
  QUALITY_UPDATE: 'quality-update',

  UPLOAD_PROGRESS: 'upload-progress',
  RECORDINGS_UPDATED: 'recordings-updated',

  PROCESSING_STATUS: 'processing-status',
  PROCESSING_COMPLETE: 'processing-complete',
  RECORDING_REJECTED: 'recording-rejected',

  ERROR: 'error',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
