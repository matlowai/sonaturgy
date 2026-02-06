'use client';

import { useState } from 'react';
import { useResultsStore } from '@/stores/resultsStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';
import { t, tReplace } from '@/lib/i18n';
import * as api from '@/lib/api';
import type { AudioResult } from '@/lib/types';

interface AudioCardProps {
  audio: AudioResult;
  index: number;
  taskId: string;
  batchIndex: number;
}

export function AudioCard({ audio, index, taskId, batchIndex }: AudioCardProps) {
  const results = useResultsStore();
  const gen = useGenerationStore();
  const { language, addToast } = useUIStore();
  const { currentTrack, playlist, playing, playTrack, pause, play, addToPlaylist } = usePlayerStore();
  const [showDetails, setShowDetails] = useState(false);
  const [scoringIdx, setScoringIdx] = useState(false);
  const [lrcingIdx, setLrcingIdx] = useState(false);

  const scoreKey = `${taskId}-${index}`;
  const lrcKey = `${taskId}-${index}`;
  const score = results.scores[scoreKey];
  const lrc = results.lrcs[lrcKey];

  const audioUrl = audio.id ? api.getAudioUrl(audio.id) : '';

  // Check if this track is currently playing
  const isThisTrack = currentTrack?.id === audio.id;
  const isPlaying = isThisTrack && playing;

  // Build track title from params
  const trackTitle = audio.params?.caption
    ? audio.params.caption.slice(0, 50) + (audio.params.caption.length > 50 ? '...' : '')
    : `Track ${index + 1}`;

  const handlePlay = () => {
    if (isThisTrack) {
      // Same track - toggle play/pause
      if (playing) {
        pause();
      } else {
        play();
      }
    } else {
      // Different track - load and play
      playTrack({ id: audio.id, url: audioUrl, title: trackTitle, batchIndex, audioIndex: index });
    }
  };

  const handleScore = async () => {
    setScoringIdx(true);
    try {
      const resp = await api.calculateScore({
        task_id: taskId,
        sample_index: index,
        caption: audio.params?.caption || '',
        lyrics: audio.params?.lyrics || '',
        bpm: audio.params?.bpm || null,
        keyscale: audio.params?.keyscale || '',
        timesignature: audio.params?.timesignature || '',
        duration: audio.params?.duration || null,
        vocal_language: audio.params?.vocal_language || 'unknown',
        score_scale: gen.scoreScale,
        inference_steps: gen.inferenceSteps,
      });
      if (resp.success) {
        results.setScore(scoreKey, resp.data.display || String(resp.data.score));
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setScoringIdx(false);
    }
  };

  const handleLRC = async () => {
    setLrcingIdx(true);
    try {
      const resp = await api.generateLRC({
        task_id: taskId,
        sample_index: index,
        vocal_language: audio.params?.vocal_language || 'unknown',
        inference_steps: gen.inferenceSteps,
      });
      if (resp.success) {
        results.setLrc(lrcKey, resp.data.lrc);
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setLrcingIdx(false);
    }
  };

  const isInPlaylist = playlist.some(t => t.id === audio.id);

  const handleAddToPlaylist = () => {
    addToPlaylist({ id: audio.id, url: audioUrl, title: trackTitle, batchIndex, audioIndex: index });
    addToast('Added to playlist', 'success');
  };

  const handleSendToSrc = () => {
    gen.setField('srcAudioId', audio.id);
    addToast('Sent to source audio', 'success');
  };

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-2">
        {/* Play button */}
        {audioUrl && (
          <button
            onClick={handlePlay}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            style={{
              backgroundColor: isPlaying ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: isPlaying ? 'white' : 'var(--text-primary)',
            }}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium truncate">
            {tReplace(language, 'results.generated_music', { n: index + 1 })}
          </h4>
          {audio.params?.caption && (
            <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
              {audio.params.caption}
            </p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-1.5">
        {audioUrl && !isInPlaylist && (
          <button className="btn btn-secondary btn-sm" onClick={handleAddToPlaylist}>
            + Playlist
          </button>
        )}
        {audioUrl && isInPlaylist && (
          <span className="btn btn-sm text-xs" style={{ color: 'var(--text-secondary)', cursor: 'default' }}>
            In playlist
          </span>
        )}
        <button className="btn btn-secondary btn-sm" onClick={handleSendToSrc}>
          {t(language, 'results.send_to_src_btn')}
        </button>
        <a
          href={audioUrl}
          download
          className="btn btn-secondary btn-sm"
        >
          {t(language, 'results.save_btn')}
        </a>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleScore}
          disabled={scoringIdx}
        >
          {scoringIdx ? '...' : t(language, 'results.score_btn')}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleLRC}
          disabled={lrcingIdx}
        >
          {lrcingIdx ? '...' : t(language, 'results.lrc_btn')}
        </button>
      </div>

      {/* Score display */}
      {score && (
        <div className="mt-2 p-2 rounded text-xs" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <strong>{tReplace(language, 'results.quality_score_label', { n: index + 1 })}:</strong> {score}
        </div>
      )}

      {/* LRC display */}
      {lrc && (
        <div className="mt-2 p-2 rounded text-xs" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <strong>{tReplace(language, 'results.lrc_label', { n: index + 1 })}:</strong>
          <pre className="whitespace-pre-wrap mt-1 max-h-32 overflow-y-auto">{lrc}</pre>
        </div>
      )}

      {/* Audio codes */}
      {audio.codes && (
        <details className="mt-2">
          <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            {tReplace(language, 'results.codes_label', { n: index + 1 })}
          </summary>
          <pre className="text-xs mt-1 p-2 rounded overflow-auto max-h-24" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            {audio.codes}
          </pre>
        </details>
      )}
    </div>
  );
}
