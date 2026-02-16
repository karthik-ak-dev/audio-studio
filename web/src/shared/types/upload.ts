import type { AllowedContentType } from '../constants/limits';

export interface GetUploadUrlRequest {
  roomId: string;
  participantName: string;
  sessionId?: string;
  contentType?: AllowedContentType;
}

export interface GetUploadUrlResponse {
  uploadUrl: string;
  key: string;
  bucket: string;
  roomId: string;
  participantName: string;
  sessionId: string | null;
}

export interface UploadCompleteRequest {
  roomId: string;
  participantName: string;
  key: string;
  sessionId?: string;
}

export interface InitiateMultipartRequest {
  roomId: string;
  participantName: string;
  contentType?: AllowedContentType;
  fileSize?: number;
}

export interface InitiateMultipartResponse {
  uploadId: string;
  key: string;
  bucket: string;
  roomId: string;
  participantName: string;
  sessionId: string | null;
  expiresAt: string;
}

export interface Part1Request {
  uploadId: string;
}

export interface Part1Response {
  url: string;
  tempKey: string;
  partNumber: 1;
  cached: true;
  expiresAt: string;
}

export interface PartUrlRequest {
  key: string;
  uploadId: string;
  partNumber: number;
}

export interface PartUrlResponse {
  url: string;
  partNumber: number;
  expiresAt: string;
}

export interface CompletePart {
  PartNumber: number;
  ETag: string;
}

export interface CompleteMultipartRequest {
  key: string;
  uploadId: string;
  parts: CompletePart[];
  roomId: string;
  participantName: string;
  sessionId?: string;
}

export interface CompleteMultipartResponse {
  success: true;
  location: string;
}

export interface AbortMultipartRequest {
  key: string;
  uploadId: string;
}

export interface ListPartsQuery {
  key: string;
  uploadId: string;
}

export interface ListPartsResponse {
  parts: Array<{
    PartNumber: number;
    ETag: string;
    Size: number;
    LastModified: string;
  }>;
  totalUploaded: number;
}
