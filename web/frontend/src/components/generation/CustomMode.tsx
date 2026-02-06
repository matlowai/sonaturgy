'use client';

import { useCallback } from 'react';
import { useGenerationStore } from '@/stores/generationStore';
import { useServiceStore } from '@/stores/serviceStore';
import { useUIStore } from '@/stores/uiStore';
import { useGeneration } from '@/hooks/useGeneration';
import { t } from '@/lib/i18n';
import {
  VALID_LANGUAGES, LANGUAGE_NAMES, TASK_TYPES, TASK_TYPES_TURBO,
  TASK_INSTRUCTIONS, TRACK_NAMES, TIME_SIGNATURES,
  BPM_MIN, BPM_MAX, DURATION_MIN, DURATION_MAX,
} from '@/lib/constants';
import { AudioUpload } from '@/components/common/AudioUpload';
import { LLMAssist } from '@/components/common/LLMAssist';
import * as api from '@/lib/api';
import { AutoTextarea } from '@/components/common/AutoTextarea';

export function CustomMode() {
  const gen = useGenerationStore();
  const { status } = useServiceStore();
  const { language } = useUIStore();
  const { formatCaption } = useGeneration();
  const { addToast } = useUIStore();

  const availableTaskTypes = status.is_turbo ? TASK_TYPES_TURBO : TASK_TYPES;

  const needsSrcAudio = ['cover', 'repaint', 'lego', 'extract', 'complete'].includes(gen.taskType);
  const needsTrackName = ['lego', 'extract'].includes(gen.taskType);
  const needsCompleteClasses = gen.taskType === 'complete';
  const needsRepainting = ['repaint', 'lego'].includes(gen.taskType);
  const needsCoverStrength = gen.taskType === 'cover';

  const updateInstruction = useCallback((taskType: string, trackName?: string, trackClasses?: string[]) => {
    let instruction = TASK_INSTRUCTIONS[taskType] || TASK_INSTRUCTIONS.text2music;
    if (trackName) {
      instruction = instruction.replace('{TRACK_NAME}', trackName);
    }
    if (trackClasses && trackClasses.length > 0) {
      instruction = instruction.replace('{TRACK_CLASSES}', trackClasses.join(', '));
    }
    gen.setField('instruction', instruction);
  }, [gen]);

  const handleRandomCaption = async () => {
    try {
      const resp = await api.getRandomExample('custom', gen.taskType);
      if (resp.success && resp.data) {
        gen.setFields({
          caption: resp.data.caption || '',
          lyrics: resp.data.lyrics || '',
          bpm: resp.data.bpm ? String(resp.data.bpm) : '',
          keyscale: resp.data.keyscale || resp.data.key_scale || '',
          timesignature: resp.data.timesignature || '',
          duration: resp.data.duration || -1,
          vocalLanguage: resp.data.vocal_language || resp.data.language || 'unknown',
        });
        addToast('Example loaded', 'success');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleConvertToCodes = async () => {
    if (!gen.srcAudioId) return;
    try {
      const resp = await api.convertToCodes(gen.srcAudioId);
      if (resp.success) {
        gen.setField('audioCodes', resp.data.audio_codes);
        addToast('Audio converted to codes', 'success');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Task Type + Instruction */}
      <div className="card space-y-3">
        <h3 className="section-title">{t(language, 'generation.required_inputs')}</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t(language, 'generation.task_type_label')}</label>
            <select
              value={gen.taskType}
              onChange={(e) => {
                const tt = e.target.value;
                gen.setField('taskType', tt);
                updateInstruction(tt, gen.trackName, gen.completeTrackClasses);
              }}
              className="w-full"
            >
              {availableTaskTypes.map((tt) => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t(language, 'generation.instruction_label')}</label>
            <input
              type="text"
              value={gen.instruction}
              onChange={(e) => gen.setField('instruction', e.target.value)}
              className="w-full text-xs"
            />
          </div>
        </div>

        {needsTrackName && (
          <div>
            <label className="label">{t(language, 'generation.track_name_label')}</label>
            <select
              value={gen.trackName}
              onChange={(e) => {
                gen.setField('trackName', e.target.value);
                updateInstruction(gen.taskType, e.target.value);
              }}
              className="w-full"
            >
              {TRACK_NAMES.map((tn) => <option key={tn} value={tn}>{tn}</option>)}
            </select>
          </div>
        )}

        {needsCompleteClasses && (
          <div>
            <label className="label">{t(language, 'generation.track_classes_label')}</label>
            <div className="flex flex-wrap gap-2">
              {TRACK_NAMES.map((tn) => (
                <label key={tn} className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={gen.completeTrackClasses.includes(tn)}
                    onChange={(e) => {
                      const classes = e.target.checked
                        ? [...gen.completeTrackClasses, tn]
                        : gen.completeTrackClasses.filter((c) => c !== tn);
                      gen.setField('completeTrackClasses', classes);
                      updateInstruction(gen.taskType, undefined, classes);
                    }}
                  />
                  {tn}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* AI Assist */}
      <LLMAssist
        onApply={(data) => {
          gen.setFields({
            caption: data.caption,
            lyrics: data.lyrics,
            bpm: data.bpm,
            keyscale: data.keyscale,
            timesignature: data.timesignature,
            duration: data.duration,
            vocalLanguage: data.vocalLanguage,
            instrumental: data.instrumental,
            isFormatCaption: true,
          });
        }}
      />

      {/* Caption + Lyrics */}
      <div className="card space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <label className="label">{t(language, 'generation.caption_label')}</label>
            <div className="flex gap-1">
              <button className="btn btn-secondary btn-sm" onClick={handleRandomCaption}>Random</button>
              <button className="btn btn-secondary btn-sm" onClick={formatCaption}>
                {t(language, 'generation.format_btn')}
              </button>
            </div>
          </div>
          <AutoTextarea
            persistKey="custom-caption"
            minRows={2}
            maxRows={12}
            value={gen.caption}
            onChange={(e) => gen.setFields({ caption: e.target.value, isFormatCaption: false })}
            placeholder={t(language, 'generation.caption_placeholder')}
            className="w-full"
          />
        </div>

        <div>
          <label className="label">{t(language, 'generation.lyrics_label')}</label>
          <AutoTextarea
            persistKey="custom-lyrics"
            minRows={3}
            maxRows={30}
            value={gen.lyrics}
            onChange={(e) => gen.setField('lyrics', e.target.value)}
            placeholder={t(language, 'generation.lyrics_placeholder')}
            className="w-full font-mono text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={gen.instrumental}
            onChange={(e) => gen.setField('instrumental', e.target.checked)}
            id="instrumental"
          />
          <label htmlFor="instrumental" className="text-sm cursor-pointer">
            {t(language, 'generation.instrumental_label')}
          </label>
        </div>
      </div>

      {/* Metadata */}
      <div className="card space-y-3">
        <h3 className="section-title">{t(language, 'generation.optional_params')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="label">{t(language, 'generation.vocal_language_label')}</label>
            <select
              value={gen.vocalLanguage}
              onChange={(e) => gen.setField('vocalLanguage', e.target.value)}
              className="w-full"
            >
              {VALID_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{LANGUAGE_NAMES[lang] || lang}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t(language, 'generation.bpm_label')}</label>
            <input
              type="number"
              value={gen.bpm}
              onChange={(e) => gen.setField('bpm', e.target.value)}
              placeholder="e.g. 120"
              min={BPM_MIN}
              max={BPM_MAX}
              className="w-full"
            />
          </div>
          <div>
            <label className="label">{t(language, 'generation.keyscale_label')}</label>
            <input
              type="text"
              value={gen.keyscale}
              onChange={(e) => gen.setField('keyscale', e.target.value)}
              placeholder="e.g. C major"
              className="w-full"
            />
          </div>
          <div>
            <label className="label">{t(language, 'generation.timesig_label')}</label>
            <select
              value={gen.timesignature}
              onChange={(e) => gen.setField('timesignature', e.target.value)}
              className="w-full"
            >
              <option value="">Auto</option>
              {TIME_SIGNATURES.map((ts) => (
                <option key={ts} value={ts}>{ts}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t(language, 'generation.duration_label')}</label>
            <input
              type="number"
              value={gen.duration}
              onChange={(e) => gen.setField('duration', parseFloat(e.target.value) || -1)}
              min={-1}
              max={DURATION_MAX}
              className="w-full"
            />
          </div>
          <div>
            <label className="label">{t(language, 'generation.batch_size_label')}</label>
            <input
              type="number"
              value={gen.batchSize}
              onChange={(e) => gen.setField('batchSize', parseInt(e.target.value) || 1)}
              min={1}
              max={8}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Audio Uploads */}
      <div className="card space-y-3">
        <h3 className="section-title">{t(language, 'generation.audio_uploads')}</h3>
        <AudioUpload
          label={t(language, 'generation.reference_audio')}
          audioId={gen.referenceAudioId}
          onUpload={(id) => gen.setField('referenceAudioId', id)}
          onClear={() => gen.setField('referenceAudioId', null)}
        />
        {needsSrcAudio && (
          <>
            <AudioUpload
              label={t(language, 'generation.source_audio')}
              audioId={gen.srcAudioId}
              onUpload={(id) => gen.setField('srcAudioId', id)}
              onClear={() => gen.setField('srcAudioId', null)}
            />
            {gen.srcAudioId && (
              <button className="btn btn-secondary btn-sm" onClick={handleConvertToCodes}>
                {t(language, 'generation.convert_codes_btn')}
              </button>
            )}
          </>
        )}

        {/* Audio codes */}
        <div>
          <label className="label">{t(language, 'generation.lm_codes_label')}</label>
          <AutoTextarea
            persistKey="custom-codes"
            minRows={2}
            maxRows={10}
            value={gen.audioCodes}
            onChange={(e) => gen.setField('audioCodes', e.target.value)}
            placeholder={t(language, 'generation.lm_codes_placeholder')}
            className="w-full font-mono text-xs"
          />
        </div>

        {/* Repainting controls */}
        {needsRepainting && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t(language, 'generation.repainting_start')}</label>
              <input
                type="number"
                value={gen.repaintingStart}
                onChange={(e) => gen.setField('repaintingStart', parseFloat(e.target.value) || 0)}
                min={0}
                step={0.1}
                className="w-full"
              />
            </div>
            <div>
              <label className="label">{t(language, 'generation.repainting_end')}</label>
              <input
                type="number"
                value={gen.repaintingEnd}
                onChange={(e) => gen.setField('repaintingEnd', parseFloat(e.target.value) || -1)}
                min={-1}
                step={0.1}
                className="w-full"
              />
            </div>
          </div>
        )}

        {needsCoverStrength && (
          <div>
            <label className="label">{t(language, 'generation.cover_strength_label')}: {gen.audioCoverStrength.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={gen.audioCoverStrength}
              onChange={(e) => gen.setField('audioCoverStrength', parseFloat(e.target.value))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
