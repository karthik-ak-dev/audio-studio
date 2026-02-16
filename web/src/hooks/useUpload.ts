/**
 * useUpload.ts — React hook for uploading recorded audio to S3.
 *
 * Wraps the uploadService to provide React state for upload progress,
 * loading state, and error handling. Used by Studio after recording stops.
 *
 * ## Upload Flow
 *
 * The uploadService automatically chooses the upload strategy based on file size:
 *
 * ### Simple Upload (files ≤ 10MB)
 * 1. POST /api/upload/url → Get presigned S3 PUT URL (15-min expiry)
 * 2. PUT blob directly to S3
 * 3. POST /api/upload/complete → Create Recording entry in DynamoDB
 *
 * ### Multipart Upload (files > 10MB)
 * 1. POST /api/multipart-upload/initiate → Get uploadId and S3 key
 * 2. POST /api/multipart-upload/part-1 → Upload Part 1 to temp location
 *    (needed for WAV header patching — the header has placeholder sizes)
 * 3. POST /api/multipart-upload/part-url (×N) → Get presigned URLs for parts 2-N
 * 4. PUT parts to S3 (3 concurrent uploads, 10MB per part)
 * 5. POST /api/multipart-upload/complete → Server patches WAV header with
 *    correct file size, reassembles parts, creates Recording entry
 *
 * ### Fallback
 * If multipart upload fails (e.g., network issue mid-upload), automatically
 * falls back to simple upload. Upload state is persisted in IndexedDB for
 * resume support.
 *
 * ## State
 *
 * - `isUploading` — True during upload (used for progress bar visibility)
 * - `progress` — { loaded, total, percent, partNumber } updated per part
 * - `uploadError` — Error message if upload fails
 */

import { useState, useCallback } from 'react';
import { uploadFile } from '@/services/uploadService';
import type { UploadProgress } from '@/services/uploadService';
import { getSocket } from '@/services/socketService';
import { SOCKET_EVENTS } from '../shared';

export interface UseUploadReturn {
  isUploading: boolean;
  progress: UploadProgress | null;
  uploadError: string | null;
  upload: (blob: Blob, roomId: string, participantName: string, sessionId?: string) => Promise<void>;
}

export function useUpload(): UseUploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * Upload a recorded WAV blob to S3.
   * Progress callbacks update the progress state for the UploadProgress component.
   */
  const upload = useCallback(
    async (blob: Blob, roomId: string, participantName: string, sessionId?: string) => {
      setIsUploading(true);
      setUploadError(null);
      setProgress(null);

      try {
        await uploadFile(blob, roomId, participantName, sessionId, (p) => {
          setProgress(p);
          // Relay upload progress to partner via Socket.IO
          const socket = getSocket();
          if (socket.connected) {
            socket.emit(SOCKET_EVENTS.UPLOAD_PROGRESS, {
              percent: p.percent,
              participantName,
            });
          }
        });
      } catch (err) {
        setUploadError((err as Error).message);
        throw err;
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  return { isUploading, progress, uploadError, upload };
}
