'use client';

import { useGenerationStore } from '@/stores/generationStore';
import { useServiceStore } from '@/stores/serviceStore';
import { useUIStore } from '@/stores/uiStore';
import { useGeneration } from '@/hooks/useGeneration';
import { t } from '@/lib/i18n';
import { VALID_LANGUAGES, LANGUAGE_NAMES } from '@/lib/constants';
import * as api from '@/lib/api';
import { AutoTextarea } from '@/components/common/AutoTextarea';

export function SimpleMode() {
  const gen = useGenerationStore();
  const service = useServiceStore();
  const { language } = useUIStore();
  const { createSample } = useGeneration();
  const { addToast } = useUIStore();

  const llmReady = service.status.llm_initialized;
  const ditReady = service.status.dit_initialized;

  const handleRandomExample = async () => {
    try {
      const resp = await api.getRandomExample('simple');
      if (resp.success && resp.data) {
        gen.setField('simpleQuery', resp.data.query || resp.data.description || '');
        addToast('Random example loaded', 'success');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  return (
    <div className="card space-y-3">
      <h3 className="section-title">{t(language, 'generation.mode_simple')}</h3>

      {!llmReady && (
        <div className="text-xs p-3 rounded" style={{ backgroundColor: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
          <div className="font-medium mb-1" style={{ color: '#eab308' }}>
            LLM Required for Simple Mode
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {!ditReady ? (
              <>Launch both <strong>DiT</strong> and <strong>LLM</strong> from the sidebar to use Simple Mode. The LLM generates captions, lyrics, and metadata from your description.</>
            ) : (
              <>The DiT model is loaded but the LLM is not. Click <strong>&quot;Launch LLM&quot;</strong> in the sidebar to enable AI-assisted generation. You can still use <strong>Custom Mode</strong> to generate music directly.</>
            )}
          </div>
        </div>
      )}

      <div>
        <label className="label">{t(language, 'generation.simple_query_label')}</label>
        <div className="flex gap-2">
          <AutoTextarea
            persistKey="simple-query"
            minRows={2}
            maxRows={10}
            value={gen.simpleQuery}
            onChange={(e) => gen.setField('simpleQuery', e.target.value)}
            placeholder={llmReady
              ? t(language, 'generation.simple_query_placeholder')
              : 'Initialize the LLM first to use this feature...'
            }
            className="flex-1 w-full"
            disabled={!llmReady}
          />
          <button
            className="btn btn-secondary btn-sm self-start"
            onClick={handleRandomExample}
            title="Random example"
            disabled={!llmReady}
          >
            Dice
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={gen.simpleInstrumental}
            onChange={(e) => gen.setField('simpleInstrumental', e.target.checked)}
            id="simple-instrumental"
            disabled={!llmReady}
          />
          <label htmlFor="simple-instrumental" className="text-sm cursor-pointer">
            {t(language, 'generation.instrumental_label')}
          </label>
        </div>

        <div className="flex-1">
          <label className="label">{t(language, 'generation.simple_vocal_language_label')}</label>
          <select
            value={gen.simpleVocalLanguage}
            onChange={(e) => gen.setField('simpleVocalLanguage', e.target.value)}
            className="w-full"
            disabled={!llmReady}
          >
            {VALID_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>{LANGUAGE_NAMES[lang] || lang} ({lang})</option>
            ))}
          </select>
        </div>
      </div>

      <button className="btn btn-primary" onClick={createSample} disabled={!llmReady}>
        {t(language, 'generation.create_sample_btn')}
      </button>

      {/* Editable generated caption/lyrics */}
      {gen.caption && (
        <div className="space-y-2 mt-3 p-3 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div>
            <label className="label">Caption</label>
            <AutoTextarea
              persistKey="simple-caption"
              minRows={2}
              maxRows={12}
              value={gen.caption}
              onChange={(e) => gen.setField('caption', e.target.value)}
              className="w-full text-sm"
            />
          </div>
          <div>
            <label className="label">Lyrics</label>
            <AutoTextarea
              persistKey="simple-lyrics"
              minRows={3}
              maxRows={30}
              value={gen.lyrics}
              onChange={(e) => gen.setField('lyrics', e.target.value)}
              className="w-full text-xs font-mono"
              placeholder="[Verse 1]..."
            />
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium">BPM:</label>
              <input
                type="number"
                value={gen.bpm || ''}
                onChange={(e) => gen.setField('bpm', e.target.value)}
                className="w-16 text-xs px-1.5 py-0.5"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium">Key:</label>
              <input
                type="text"
                value={gen.keyscale || ''}
                onChange={(e) => gen.setField('keyscale', e.target.value)}
                className="w-20 text-xs px-1.5 py-0.5"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium">Duration:</label>
              <input
                type="number"
                value={gen.duration > 0 ? gen.duration : ''}
                onChange={(e) => gen.setField('duration', parseInt(e.target.value) || -1)}
                className="w-16 text-xs px-1.5 py-0.5"
              />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
