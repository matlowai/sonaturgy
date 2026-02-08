'use client';

import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useGeneration } from '@/hooks/useGeneration';
import { useResultsStore } from '@/stores/resultsStore';
import { customToStage } from '@/lib/stageConversion';
import { t } from '@/lib/i18n';
import { SimpleMode } from './SimpleMode';
import { CustomMode } from './CustomMode';
import { PipelineMode } from './PipelineMode';
import { AdvancedSettings } from './AdvancedSettings';
import { Spinner } from '@/components/common/Spinner';

const MODES = [
  { key: 'simple', label: 'generation.mode_simple' },
  { key: 'custom', label: 'generation.mode_custom' },
  { key: 'pipeline', labelText: 'Pipeline' },
] as const;

export function GenerationPanel() {
  const { mode, setMode, autoGen } = useGenerationStore();
  const { language, addToast } = useUIStore();
  const pipe = usePipelineStore();
  const { generate } = useGeneration();
  const { generating } = useResultsStore();
  const gen = useGenerationStore();

  const handleGenerate = async () => {
    const taskId = await generate();
    // WebSocket will handle the rest via the main page
  };

  const handleAddToPipeline = () => {
    const stage = customToStage(gen);
    // Populate empty pipeline conditioning from custom state
    pipe.setFieldsIfEmpty({
      caption: gen.caption,
      lyrics: gen.lyrics,
      instrumental: gen.instrumental,
      vocalLanguage: gen.vocalLanguage,
      bpm: gen.bpm,
      keyscale: gen.keyscale,
      timesignature: gen.timesignature,
      duration: gen.duration,
    });
    // If pipeline caption matches custom, clear stage-level override
    if (stage.caption && stage.caption === pipe.caption) {
      stage.caption = undefined;
    }
    if (stage.lyrics && stage.lyrics === pipe.lyrics) {
      stage.lyrics = undefined;
    }
    pipe.addStageFromConfig(stage);
    gen.setMode('pipeline');
    addToast('Added as pipeline stage', 'success');
  };

  return (
    <div className="space-y-4">
      {/* Mode Selector */}
      <div className="flex items-center gap-2">
        <label className="label mb-0">{t(language, 'generation.mode_label')}:</label>
        <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`px-4 py-1.5 text-sm ${mode === m.key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-tertiary)]'}`}
              onClick={() => setMode(m.key)}
            >
              {'labelText' in m ? m.labelText : t(language, m.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Mode Content */}
      {mode === 'pipeline' ? (
        <PipelineMode />
      ) : (
        <>
          {mode === 'simple' ? <SimpleMode /> : <CustomMode />}

          {/* Advanced Settings */}
          <AdvancedSettings />

          {/* Resume indicator */}
          {gen.initLatentId && gen.tStart < 1.0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded text-xs" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent)' }}>
              <span>Resuming from latent {gen.initLatentId.slice(0, 8)}... (denoise: {gen.tStart.toFixed(2)})</span>
              <button className="underline hover:no-underline" onClick={() => gen.setFields({ initLatentId: null, tStart: 1.0 })}>Clear</button>
            </div>
          )}

          {/* Generate Button */}
          <div className="flex items-center gap-3">
            <button
              className="btn btn-primary text-base px-8 py-3 flex items-center gap-2"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating && <Spinner size="sm" />}
              {generating ? 'Generating...' : t(language, 'generation.generate_btn')}
            </button>

            {mode === 'custom' && (
              <button
                className="btn text-sm px-4 py-3"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                onClick={handleAddToPipeline}
                title="Add current settings as a pipeline stage"
              >
                + Pipeline
              </button>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoGen}
                onChange={(e) => gen.setField('autoGen', e.target.checked)}
                id="autogen"
              />
              <label htmlFor="autogen" className="text-xs cursor-pointer">
                {t(language, 'generation.autogen_label')}
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
