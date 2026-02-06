'use client';

import { useCallback, useRef, useState } from 'react';
import * as api from '@/lib/api';

interface AudioUploadProps {
  label: string;
  audioId: string | null;
  onUpload: (id: string, filename: string) => void;
  onClear: () => void;
}

export function AudioUpload({ label, audioId, onUpload, onClear }: AudioUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string>('');
  const [uploading, setUploading] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const resp = await api.uploadAudio(file);
      if (resp.success) {
        onUpload(resp.data.id, resp.data.filename);
        setFilename(resp.data.filename);
      }
    } catch {
    } finally {
      setUploading(false);
    }
  }, [onUpload]);

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading...' : 'Choose File'}
        </button>
        {audioId && (
          <>
            <span className="text-xs truncate max-w-[150px]" style={{ color: 'var(--text-secondary)' }}>
              {filename}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={onClear}>
              Clear
            </button>
          </>
        )}
        {audioId && (
          <audio src={api.getAudioUrl(audioId)} controls className="h-8" style={{ maxWidth: '200px' }} />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
