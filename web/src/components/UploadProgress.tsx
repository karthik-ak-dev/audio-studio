/**
 * UploadProgress.tsx — Upload progress bar for recording file uploads.
 *
 * Shown in the Studio page after recording stops. Displays the upload
 * progress as the WAV file is sent to S3 via the server's presigned URL flow.
 *
 * ## States
 *
 * 1. **Hidden** — No upload in progress and no progress data (default)
 * 2. **Uploading** — Progress bar with percentage, animated fill
 * 3. **Complete** — Shows "Upload complete" at 100%
 * 4. **Error** — Red error banner with the failure message
 *
 * ## Upload flow (from uploadService)
 *
 * For files ≤10MB (simple upload):
 *   1. POST /api/upload/url → get presigned S3 PUT URL
 *   2. PUT blob to S3 directly
 *   3. POST /api/upload/complete → create Recording entry in DynamoDB
 *
 * For files >10MB (multipart upload):
 *   1. POST /api/multipart-upload/initiate → get uploadId
 *   2. Upload parts concurrently (3 at a time, 10MB each)
 *   3. POST /api/multipart-upload/complete → WAV header patching + assembly
 *
 * Progress callbacks fire after each part completes, updating the percent.
 */

import type { UploadProgress as UploadProgressType } from '@/services/uploadService';

interface UploadProgressProps {
  progress: UploadProgressType | null;
  isUploading: boolean;
  error: string | null;
}

export default function UploadProgress({ progress, isUploading, error }: UploadProgressProps) {
  /* Error state takes priority — show failure message */
  if (error) {
    return (
      <div className="px-4 py-3 text-sm text-danger-light border border-danger rounded-lg bg-danger-dark/50">
        Upload failed: {error}
      </div>
    );
  }

  /* Hidden when not uploading and no progress data */
  if (!isUploading && !progress) return null;

  const percent = progress?.percent ?? 0;

  return (
    <div className="px-4 py-3 bg-surface-800 rounded-lg">
      <div className="flex justify-between mb-1 text-sm text-surface-200">
        <span>{isUploading ? 'Uploading recording...' : 'Upload complete'}</span>
        <span>{percent}%</span>
      </div>
      {/* Progress bar — width transitions smoothly via CSS */}
      <div className="h-2 overflow-hidden bg-surface-700 rounded-full">
        <div
          className="h-full transition-all duration-300 rounded-full bg-accent-400"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
