import type { UploadProgress as UploadProgressType } from '@/services/uploadService';

interface UploadProgressProps {
  progress: UploadProgressType | null;
  isUploading: boolean;
  error: string | null;
}

export default function UploadProgress({ progress, isUploading, error }: UploadProgressProps) {
  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-500 rounded-lg px-4 py-3 text-red-200 text-sm">
        Upload failed: {error}
      </div>
    );
  }

  if (!isUploading && !progress) return null;

  const percent = progress?.percent ?? 0;

  return (
    <div className="bg-gray-800 rounded-lg px-4 py-3">
      <div className="flex justify-between text-sm text-gray-300 mb-1">
        <span>{isUploading ? 'Uploading recording...' : 'Upload complete'}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-studio-500 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
