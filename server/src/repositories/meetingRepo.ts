/**
 * meetingRepo.ts — Data access layer for the Meetings table.
 *
 * DynamoDB Table: AudioStudio_Meetings
 * Primary Key:    meetingId (partition key, no sort key)
 * Model Type:     Meeting (defined in shared/types/meeting.ts)
 *
 * Operations:
 *   - CRUD: create, get by ID, get all, update status, delete
 *   - Role assignment: assignHostEmail, assignGuestEmail (race-safe with conditional writes)
 *   - Role lookup: getParticipantRole (determines host/guest by email match)
 *
 * Race safety: Host and guest assignment use DynamoDB conditional expressions
 * to prevent two concurrent requests from overwriting each other's assignment.
 * If the slot is already taken, the write fails gracefully and returns false.
 */
import { PutCommand, GetCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';
import type { Meeting, MeetingStatus } from '../shared';
import { logger } from '../utils/logger';

/** Create a new meeting. Fails if meetingId already exists (conditional write). */
export async function createMeeting(meeting: Meeting): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLES.MEETINGS,
      Item: meeting,
      ConditionExpression: 'attribute_not_exists(meetingId)',
    }),
  );
  logger.info('Meeting created', { meetingId: meeting.meetingId });
}

export async function getMeetingById(meetingId: string): Promise<Meeting | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLES.MEETINGS,
      Key: { meetingId },
    }),
  );
  return (result.Item as Meeting) ?? null;
}

export async function getAllMeetings(): Promise<Meeting[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLES.MEETINGS,
    }),
  );
  return (result.Items as Meeting[]) ?? [];
}

export async function updateMeetingStatus(meetingId: string, status: MeetingStatus): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.MEETINGS,
      Key: { meetingId },
      UpdateExpression: 'SET #s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': status },
      ConditionExpression: 'attribute_exists(meetingId)',
    }),
  );
}

/**
 * Race-safe host email assignment. Uses a conditional write that only
 * succeeds if hostEmail is not yet set. Returns false if already assigned.
 */
export async function assignHostEmail(meetingId: string, email: string): Promise<boolean> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.MEETINGS,
        Key: { meetingId },
        UpdateExpression: 'SET hostEmail = :email',
        ConditionExpression: 'attribute_not_exists(hostEmail) OR hostEmail = :empty',
        ExpressionAttributeValues: { ':email': email, ':empty': null },
      }),
    );
    return true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return false; // Already assigned
    }
    throw err;
  }
}

/**
 * Race-safe guest email assignment for slot A or B. Uses a conditional
 * write that only succeeds if the target slot is not yet assigned.
 */
export async function assignGuestEmail(
  meetingId: string,
  slot: 'A' | 'B',
  email: string,
  name: string,
): Promise<boolean> {
  const emailAttr = slot === 'A' ? 'guestAEmail' : 'guestBEmail';
  const nameAttr = slot === 'A' ? 'guestAName' : 'guestBName';

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.MEETINGS,
        Key: { meetingId },
        UpdateExpression: `SET ${emailAttr} = :email, ${nameAttr} = :name`,
        ConditionExpression: `attribute_not_exists(${emailAttr}) OR ${emailAttr} = :empty`,
        ExpressionAttributeValues: { ':email': email, ':name': name, ':empty': null },
      }),
    );
    return true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLES.MEETINGS,
      Key: { meetingId },
    }),
  );
  logger.info('Meeting deleted', { meetingId });
}

/** Determine a user's role (host/guest) by matching their email against the meeting record */
export async function getParticipantRole(
  meetingId: string,
  email: string,
): Promise<'host' | 'guest' | null> {
  const meeting = await getMeetingById(meetingId);
  if (!meeting) return null;

  if (meeting.hostEmail === email) return 'host';
  if (meeting.guestAEmail === email || meeting.guestBEmail === email) return 'guest';
  return null;
}
