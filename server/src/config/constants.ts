/**
 * config/constants.ts — Re-export shared constants for server-side convenience.
 *
 * Allows server code to import constants from the config layer
 * (e.g., `import { LIMITS } from './config/constants'`) as an
 * alternative to importing from '../shared' directly.
 */
export { LIMITS, AUDIO_THRESHOLDS, SOCKET_EVENTS, MEETING_STATUSES } from '../shared';
