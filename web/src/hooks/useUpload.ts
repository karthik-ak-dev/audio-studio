import { useState, useCallback } from 'react';
import { uploadFile } from '@/services/uploadService';
import type { UploadProgress } from '@/services/uploadService';

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

  const upload = useCallback(
    async (blob: Blob, roomId: string, participantName: string, sessionId?: string) => {
      setIsUploading(true);
      setUploadError(null);
      setProgress(null);

      try {
        await uploadFile(blob, roomId, participantName, sessionId, (p) => {
          setProgress(p);
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
