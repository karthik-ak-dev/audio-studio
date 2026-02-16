/**
 * utils/validators.ts — Input validation and sanitization functions.
 *
 * Centralized validation logic used by routes and services to verify
 * user input at the system boundary (before it reaches business logic).
 *
 * Validators are type guards where possible (TypeScript `is` syntax),
 * so a successful validation narrows the type in subsequent code:
 *   if (validateTitle(input)) { // input is now typed as string }
 *
 * All limits (max lengths, allowed types, max file size) are imported
 * from the shared constants layer so they stay in sync across the codebase.
 *
 * sanitizeParticipantName() is used when building S3 keys and DynamoDB
 * recordingIds to ensure only safe characters appear in storage paths.
 */
import { LIMITS, MEETING_STATUSES } from '../shared';
import type { AllowedContentType, MeetingStatus } from '../shared';

/** Basic email format validation (not RFC 5322 compliant, but sufficient for UX) */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/** Meeting title: non-empty string, max TITLE_MAX_LENGTH characters */
export function validateTitle(title: unknown): title is string {
  return (
    typeof title === 'string' && title.trim().length > 0 && title.length <= LIMITS.TITLE_MAX_LENGTH
  );
}

/** Participant display name: string, max NAME_MAX_LENGTH characters */
export function validateName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= LIMITS.NAME_MAX_LENGTH;
}

/** Meeting status: must be one of the allowed lifecycle statuses */
export function validateMeetingStatus(status: unknown): status is MeetingStatus {
  return typeof status === 'string' && (MEETING_STATUSES as readonly string[]).includes(status);
}

/** Content type: must be one of the allowed audio MIME types (e.g., 'audio/wav', 'audio/webm') */
export function validateContentType(contentType: unknown): contentType is AllowedContentType {
  return (
    typeof contentType === 'string' &&
    (LIMITS.ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)
  );
}

/** File size: optional field — if provided, must be positive and under MAX_FILE_SIZE */
export function validateFileSize(fileSize: unknown): boolean {
  if (fileSize === undefined || fileSize === null) return true; // optional
  return typeof fileSize === 'number' && fileSize > 0 && fileSize <= LIMITS.MAX_FILE_SIZE;
}

/** Part number for S3 multipart upload: integer between 1 and MAX_PARTS (inclusive) */
export function validatePartNumber(partNumber: unknown): partNumber is number {
  return (
    typeof partNumber === 'number' &&
    Number.isInteger(partNumber) &&
    partNumber >= 1 &&
    partNumber <= LIMITS.MAX_PARTS
  );
}

/** ISO 8601 date string validation (e.g., "2024-03-15T10:30:00.000Z") */
export function validateISODate(date: unknown): boolean {
  if (!date || typeof date !== 'string') return false;
  return !isNaN(Date.parse(date));
}

/**
 * Sanitizes a participant name for safe use in S3 keys and DynamoDB sort keys.
 * Replaces any character that isn't alphanumeric, hyphen, or underscore with '_'.
 * Example: "John Doe (host)" → "John_Doe__host_"
 */
export function sanitizeParticipantName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_');
}
