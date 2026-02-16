import { LIMITS, MEETING_STATUSES } from '../shared';
import type { AllowedContentType, MeetingStatus } from '../shared';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function validateTitle(title: unknown): title is string {
  return typeof title === 'string' && title.trim().length > 0 && title.length <= LIMITS.TITLE_MAX_LENGTH;
}

export function validateName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= LIMITS.NAME_MAX_LENGTH;
}

export function validateMeetingStatus(status: unknown): status is MeetingStatus {
  return typeof status === 'string' && (MEETING_STATUSES as readonly string[]).includes(status);
}

export function validateContentType(contentType: unknown): contentType is AllowedContentType {
  return (
    typeof contentType === 'string' &&
    (LIMITS.ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)
  );
}

export function validateFileSize(fileSize: unknown): boolean {
  if (fileSize === undefined || fileSize === null) return true; // optional
  return typeof fileSize === 'number' && fileSize > 0 && fileSize <= LIMITS.MAX_FILE_SIZE;
}

export function validatePartNumber(partNumber: unknown): partNumber is number {
  return (
    typeof partNumber === 'number' &&
    Number.isInteger(partNumber) &&
    partNumber >= 1 &&
    partNumber <= LIMITS.MAX_PARTS
  );
}

export function validateISODate(date: unknown): boolean {
  if (!date || typeof date !== 'string') return false;
  return !isNaN(Date.parse(date));
}

export function sanitizeParticipantName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_');
}
