'use client';

import { useResultsStore } from '@/stores/resultsStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useBatchNavigation } from '@/hooks/useBatchNavigation';
import { t, tReplace } from '@/lib/i18n';
import { AudioCard } from './AudioCard';
import { Spinner } from '@/components/common/Spinner';
import * as api from '@/lib/api';

export function ResultsPanel() {
  const results = useResultsStore();
  const gen = useGenerationStore();
  const { language, addToast } = useUIStore();
  const { addToPlaylist } = usePlayerStore();
  const { goNext, goPrev, restoreParams, currentIndex, totalBatches, currentBatch } = useBatchNavigation();

  if (results.generating) {
    return (
      <div className="card">
        <h2 className="section-title">{t(language, 'results.title')}</h2>
        <div className="flex items-center gap-3 mb-3">
          <Spinner />
          <span className="text-sm">{results.statusMessage || 'Generating...'}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${results.progress * 100}%` }} />
        </div>
        <span className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          {(results.progress * 100).toFixed(0)}%
        </span>
      </div>
    );
  }

  if (!currentBatch) {
    return (
      <div className="card">
        <h2 className="section-title">{t(language, 'results.title')}</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          No results yet. Generate music to see results here.
        </p>
      </div>
    );
  }

  const batch = currentBatch;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title mb-0">{t(language, 'results.title')}</h2>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={goPrev} disabled={currentIndex <= 0}>
              {t(language, 'results.prev_btn')}
            </button>
            <span className="text-sm">
              {tReplace(language, 'results.batch_indicator', {
                current: currentIndex + 1,
                total: totalBatches,
              })}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={goNext} disabled={currentIndex >= totalBatches - 1}>
              {t(language, 'results.next_btn')}
            </button>
          </div>
        </div>

        {/* Audio Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {batch.audios.map((audio, idx) => (
            <AudioCard
              key={audio.id || idx}
              audio={audio}
              index={idx}
              taskId={batch.taskId}
              batchIndex={currentIndex}
            />
          ))}
        </div>
      </div>

      {/* Batch Actions */}
      <div className="card">
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              batch.audios.forEach((audio, idx) => {
                if (!audio.id) return;
                addToPlaylist({
                  id: audio.id,
                  url: api.getAudioUrl(audio.id),
                  title: audio.params?.caption
                    ? audio.params.caption.slice(0, 50) + (audio.params.caption.length > 50 ? '...' : '')
                    : `Track ${idx + 1}`,
                  batchIndex: currentIndex,
                  audioIndex: idx,
                });
              });
              addToast(`Added ${batch.audios.length} tracks to playlist`, 'success');
            }}
          >
            + All to Playlist
          </button>
          <button className="btn btn-secondary btn-sm" onClick={restoreParams}>
            {t(language, 'results.restore_params_btn')}
          </button>
          {batch.taskId && (
            <a
              href={api.downloadAllUrl(batch.taskId)}
              className="btn btn-secondary btn-sm"
              download
            >
              {t(language, 'results.all_files_label')}
            </a>
          )}
        </div>

        {/* CoT Reasoning — show what the LLM decided */}
        {batch.extra?.lm_metadata && (
          <details className="mt-3" open>
            <summary className="text-sm cursor-pointer font-medium" style={{ color: 'var(--accent)' }}>
              AI Reasoning (CoT)
            </summary>
            <div className="mt-2 p-3 rounded text-xs space-y-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              {batch.extra.lm_metadata.caption && (
                <div>
                  <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Caption: </span>
                  <span>{batch.extra.lm_metadata.caption}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {batch.extra.lm_metadata.bpm != null && (
                  <span><span className="font-medium" style={{ color: 'var(--text-secondary)' }}>BPM:</span> {batch.extra.lm_metadata.bpm}</span>
                )}
                {batch.extra.lm_metadata.keyscale && (
                  <span><span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Key:</span> {batch.extra.lm_metadata.keyscale}</span>
                )}
                {batch.extra.lm_metadata.duration != null && (
                  <span><span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Duration:</span> {batch.extra.lm_metadata.duration}s</span>
                )}
                {batch.extra.lm_metadata.timesignature && (
                  <span><span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Time Sig:</span> {batch.extra.lm_metadata.timesignature}</span>
                )}
                {batch.extra.lm_metadata.vocal_language && (
                  <span><span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Language:</span> {batch.extra.lm_metadata.vocal_language}</span>
                )}
              </div>
              {batch.extra.lm_metadata.lyrics && (
                <div>
                  <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Lyrics: </span>
                  <pre className="whitespace-pre-wrap mt-1 max-h-32 overflow-y-auto font-mono">{batch.extra.lm_metadata.lyrics}</pre>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Time Costs */}
        {batch.extra?.time_costs && Object.keys(batch.extra.time_costs).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {Object.entries(batch.extra.time_costs).map(([key, val]) => (
              <span key={key}>{key.replace(/_/g, ' ')}: {typeof val === 'number' ? val.toFixed(1) : val}s</span>
            ))}
          </div>
        )}

        {/* Generation Details */}
        {batch.params && (
          <details className="mt-3">
            <summary className="text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              {t(language, 'results.generation_details')}
            </summary>
            <pre className="text-xs mt-2 p-2 rounded overflow-auto" style={{ backgroundColor: 'var(--bg-tertiary)', maxHeight: '200px' }}>
              {JSON.stringify(batch.params, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
