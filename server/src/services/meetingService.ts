/**
 * meetingService.ts — Business logic for meeting CRUD and participant assignment.
 *
 * This is the service layer between routes/socket handlers and the meetingRepo.
 * It handles:
 *   - Input validation (title, emails, names)
 *   - Meeting creation with UUID generation
 *   - Race-safe host/guest email assignment (delegates to repo conditional writes)
 *   - Auto-creation of meetings when users join via socket (getOrCreateMeeting)
 *
 * Used by:
 *   - routes/meetings.ts: REST API endpoints
 *   - socket/session.ts: auto-create meeting on join-room
 *   - socket/recording.ts: update meeting status on start/stop recording
 */
import { v4 as uuid } from 'uuid';
import type { Meeting, MeetingStatus } from '../shared';
import { MEETING_STATUS } from '../shared';
import * as meetingRepo from '../repositories/meetingRepo';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { validateTitle, validateEmail, validateName } from '../utils/validators';
import { logger } from '../utils/logger';

export interface CreateMeetingInput {
  title: string;
  hostName?: string;
  hostEmail?: string;
  guestName?: string;
  guestEmail?: string;
  scheduledTime?: string;
}

export async function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
  if (!validateTitle(input.title)) {
    throw new ValidationError('Title is required and must be under 255 characters');
  }

  if (input.hostName !== undefined && !validateName(input.hostName)) {
    throw new ValidationError('Host name too long');
  }
  if (input.hostEmail && !validateEmail(input.hostEmail)) {
    throw new ValidationError('Invalid host email');
  }
  if (input.guestName !== undefined && !validateName(input.guestName)) {
    throw new ValidationError('Guest name too long');
  }
  if (input.guestEmail && !validateEmail(input.guestEmail)) {
    throw new ValidationError('Invalid guest email');
  }
  if (input.hostEmail && input.guestEmail &&
      input.hostEmail.toLowerCase() === input.guestEmail.toLowerCase()) {
    throw new ConflictError('Host and guest cannot use the same email');
  }

  const meeting: Meeting = {
    meetingId: uuid(),
    title: input.title.trim(),
    hostName: input.hostName || null,
    hostEmail: input.hostEmail || null,
    guestName: input.guestName || null,
    guestEmail: input.guestEmail || null,
    scheduledTime: input.scheduledTime || null,
    status: MEETING_STATUS.SCHEDULED,
    createdAt: new Date().toISOString(),
  };

  await meetingRepo.createMeeting(meeting);
  return meeting;
}

export async function getMeeting(meetingId: string): Promise<Meeting> {
  const meeting = await meetingRepo.getMeetingById(meetingId);
  if (!meeting) throw new NotFoundError(`Meeting ${meetingId} not found`);
  return meeting;
}

export async function getAllMeetings(): Promise<Meeting[]> {
  return meetingRepo.getAllMeetings();
}

export async function updateStatus(meetingId: string, status: MeetingStatus): Promise<void> {
  await getMeeting(meetingId); // Throws NotFoundError if missing
  await meetingRepo.updateMeetingStatus(meetingId, status);
}

export async function assignHost(meetingId: string, email: string, name?: string): Promise<boolean> {
  if (!validateEmail(email)) throw new ValidationError('Invalid email');
  if (name !== undefined && !validateName(name)) throw new ValidationError('Host name too long');

  // Prevent same email from being both host and guest
  const meeting = await getMeeting(meetingId);
  if (meeting.guestEmail && meeting.guestEmail.toLowerCase() === email.toLowerCase()) {
    throw new ConflictError('This email is already assigned as guest for this meeting');
  }

  const assigned = await meetingRepo.assignHostEmail(meetingId, email, name);
  if (!assigned) {
    logger.warn('Host email already assigned', { meetingId, email });
  }
  return assigned;
}

export async function assignGuest(
  meetingId: string,
  email: string,
  name: string,
): Promise<boolean> {
  if (!validateEmail(email)) throw new ValidationError('Invalid email');
  if (!validateName(name)) throw new ValidationError('Name too long');

  // Prevent same email from being both host and guest
  const meeting = await getMeeting(meetingId);
  if (meeting.hostEmail && meeting.hostEmail.toLowerCase() === email.toLowerCase()) {
    throw new ConflictError('This email is already assigned as host for this meeting');
  }

  const assigned = await meetingRepo.assignGuestEmail(meetingId, email, name);
  if (!assigned) {
    throw new ConflictError(`Guest already assigned for meeting ${meetingId}`);
  }
  return assigned;
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  await getMeeting(meetingId); // Throws NotFoundError if missing
  await meetingRepo.deleteMeeting(meetingId);
}

/**
 * Get an existing meeting or auto-create one. Used by the socket join-room
 * handler so users can join a room by ID without pre-creating the meeting
 * through the REST API. Race-safe: if two users try to create simultaneously,
 * one wins and the other fetches the winner's record.
 */
export async function getOrCreateMeeting(meetingId: string, title?: string): Promise<Meeting> {
  const existing = await meetingRepo.getMeetingById(meetingId);
  if (existing) return existing;

  // Auto-create with the provided meetingId (used by socket join-room)
  const meeting: Meeting = {
    meetingId,
    title: title || `Meeting ${meetingId.slice(0, 8)}`,
    hostName: null,
    hostEmail: null,
    guestName: null,
    guestEmail: null,
    scheduledTime: null,
    status: MEETING_STATUS.ACTIVE,
    createdAt: new Date().toISOString(),
  };

  try {
    await meetingRepo.createMeeting(meeting);
  } catch (err: any) {
    // Race condition: another request created it
    if (err.name === 'ConditionalCheckFailedException') {
      return (await meetingRepo.getMeetingById(meetingId))!;
    }
    throw err;
  }

  return meeting;
}
