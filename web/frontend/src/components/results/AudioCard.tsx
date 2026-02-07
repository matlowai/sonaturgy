'use client';

import { useState } from 'react';
import { useResultsStore } from '@/stores/resultsStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';
import { t, tReplace } from '@/lib/i18n';
import * as api from '@/lib/api';
import { mapParamsToFields, paramsToStage } from '@/lib/stageConversion';
import { usePipelineStore } from '@/stores/pipelineStore';
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
  const [decodingLatent, setDecodingLatent] = useState(false);

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

  const handleSendToRef = () => {
    gen.setField('referenceAudioId', audio.id);
    addToast('Sent to reference audio', 'success');
  };

  const handlePlayLatent = async () => {
    if (!audio.latentId) return;
    setDecodingLatent(true);
    try {
      const resp = await api.decodeLatent(audio.latentId);
      if (resp.success) {
        const previewUrl = api.getAudioUrl(resp.data.audio_id);
        playTrack({
          id: resp.data.audio_id,
          url: previewUrl,
          title: `Latent ${audio.latentId.slice(0, 8)}`,
        });
        addToast('Playing latent preview', 'success');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setDecodingLatent(false);
    }
  };

  const handleAddToPipeline = () => {
    if (!audio.params) {
      addToast('No params to build stage from', 'info');
      return;
    }
    const pipe = usePipelineStore.getState();
    const stage = paramsToStage(audio.params, audio.latentId);
    // Populate empty pipeline conditioning from result params
    pipe.setFieldsIfEmpty({
      caption: audio.params.caption || '',
      lyrics: audio.params.lyrics || '',
      instrumental: audio.params.instrumental ?? false,
      vocalLanguage: audio.params.vocal_language || 'unknown',
      bpm: audio.params.bpm ? String(audio.params.bpm) : '',
      keyscale: audio.params.keyscale || '',
      timesignature: audio.params.timesignature || '',
      duration: audio.params.duration ?? -1,
    });
    // Clear stage-level overrides if they match pipeline conditioning
    if (stage.caption && stage.caption === pipe.caption) stage.caption = undefined;
    if (stage.lyrics && stage.lyrics === pipe.lyrics) stage.lyrics = undefined;
    pipe.addStageFromConfig(stage);
    gen.setMode('pipeline');
    addToast(`Added to pipeline${audio.latentId ? ' (with latent)' : ''}`, 'success');
  };

  const handleResumeCheckpoint = () => {
    if (!audio.latentCheckpointId || audio.checkpointStep == null) {
      addToast('No checkpoint available', 'info');
      return;
    }
    const totalSteps = audio.params?.inference_steps || gen.inferenceSteps;
    // Approximate tStart: schedule goes from ~1.0 to ~0.0, checkpoint at step K means
    // roughly (1 - K/N) of the schedule remains. This is an approximation — user can fine-tune.
    const approxTStart = Math.max(0.05, 1.0 - audio.checkpointStep / totalSteps);
    gen.setFields({
      ...(audio.params ? mapParamsToFields(audio.params) : {}),
      initLatentId: audio.latentCheckpointId,
      tStart: parseFloat(approxTStart.toFixed(2)),
      checkpointStep: null,  // Don't re-checkpoint when resuming
    });
    addToast(`Resuming from checkpoint at step ${audio.checkpointStep} (denoise: ${approxTStart.toFixed(2)})`, 'success');
  };

  const handleRestoreParams = () => {
    if (!audio.params) {
      addToast('No params to restore', 'info');
      return;
    }
    gen.setFields({
      ...mapParamsToFields(audio.params),
      initLatentId: audio.latentId || null,
    });
    addToast(
      audio.latentId
        ? `Params restored from Sample ${index + 1} (with latent)`
        : `Params restored from Sample ${index + 1}`,
      'success',
    );
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
        {audio.latentId && (
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'var(--accent)', color: 'var(--bg-primary)', opacity: 0.8 }}
            title={`Latent stored: ${audio.latentId}`}
          >
            latent
          </span>
        )}
        {audio.latentId && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={handlePlayLatent}
            disabled={decodingLatent}
          >
            {decodingLatent ? '...' : '\u25B6 Play Latent'}
          </button>
        )}
        {audio.latentCheckpointId && (
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'var(--success, #22c55e)', color: 'var(--bg-primary)', opacity: 0.8 }}
            title={`Checkpoint at step ${audio.checkpointStep}: ${audio.latentCheckpointId}`}
          >
            ckpt@{audio.checkpointStep}
          </span>
        )}
        <button className="btn btn-secondary btn-sm" onClick={handleRestoreParams}>
          {t(language, 'results.restore_btn')}
        </button>
        {audio.latentCheckpointId && (
          <button className="btn btn-secondary btn-sm" onClick={handleResumeCheckpoint}>
            Resume Ckpt
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={handleSendToSrc}>
          {t(language, 'results.send_to_src_btn')}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={handleSendToRef}>
          {t(language, 'results.send_to_ref_btn')}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={handleAddToPipeline}>
          + Pipeline
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
