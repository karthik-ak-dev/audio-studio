import { v4 as uuid } from 'uuid';
import type { Meeting, MeetingStatus } from '../shared';
import * as meetingRepo from '../repositories/meetingRepo';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { validateTitle, validateEmail, validateName } from '../utils/validators';
import { logger } from '../utils/logger';

export interface CreateMeetingInput {
  title: string;
  hostEmail?: string;
  guestAName?: string;
  guestAEmail?: string;
  guestBName?: string;
  guestBEmail?: string;
  scheduledTime?: string;
}

export async function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
  if (!validateTitle(input.title)) {
    throw new ValidationError('Title is required and must be under 255 characters');
  }

  if (input.hostEmail && !validateEmail(input.hostEmail)) {
    throw new ValidationError('Invalid host email');
  }
  if (input.guestAEmail && !validateEmail(input.guestAEmail)) {
    throw new ValidationError('Invalid guest A email');
  }
  if (input.guestBEmail && !validateEmail(input.guestBEmail)) {
    throw new ValidationError('Invalid guest B email');
  }
  if (input.guestAName !== undefined && !validateName(input.guestAName)) {
    throw new ValidationError('Guest A name too long');
  }
  if (input.guestBName !== undefined && !validateName(input.guestBName)) {
    throw new ValidationError('Guest B name too long');
  }

  const meeting: Meeting = {
    meetingId: uuid(),
    title: input.title.trim(),
    hostEmail: input.hostEmail || null,
    guestAName: input.guestAName || null,
    guestAEmail: input.guestAEmail || null,
    guestBName: input.guestBName || null,
    guestBEmail: input.guestBEmail || null,
    scheduledTime: input.scheduledTime || null,
    status: 'scheduled',
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

export async function assignHost(meetingId: string, email: string): Promise<boolean> {
  if (!validateEmail(email)) throw new ValidationError('Invalid email');
  const assigned = await meetingRepo.assignHostEmail(meetingId, email);
  if (!assigned) {
    logger.warn('Host email already assigned', { meetingId, email });
  }
  return assigned;
}

export async function assignGuest(
  meetingId: string,
  slot: 'A' | 'B',
  email: string,
  name: string,
): Promise<boolean> {
  if (!validateEmail(email)) throw new ValidationError('Invalid email');
  if (!validateName(name)) throw new ValidationError('Name too long');

  const assigned = await meetingRepo.assignGuestEmail(meetingId, slot, email, name);
  if (!assigned) {
    throw new ConflictError(`Guest ${slot} already assigned for meeting ${meetingId}`);
  }
  return assigned;
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  await getMeeting(meetingId); // Throws NotFoundError if missing
  await meetingRepo.deleteMeeting(meetingId);
}

export async function getOrCreateMeeting(meetingId: string, title?: string): Promise<Meeting> {
  const existing = await meetingRepo.getMeetingById(meetingId);
  if (existing) return existing;

  // Auto-create with the provided meetingId (used by socket join-room)
  const meeting: Meeting = {
    meetingId,
    title: title || `Meeting ${meetingId.slice(0, 8)}`,
    hostEmail: null,
    guestAName: null,
    guestAEmail: null,
    guestBName: null,
    guestBEmail: null,
    scheduledTime: null,
    status: 'active',
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
