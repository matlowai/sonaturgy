'use client';

import { useState } from 'react';
import { useServiceStore } from '@/stores/serviceStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';
import { AutoTextarea } from './AutoTextarea';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';
import * as help from '@/lib/help-text';
import * as api from '@/lib/api';
import { VALID_LANGUAGES, LANGUAGE_NAMES } from '@/lib/constants';

interface LLMAssistProps {
  /** Called with generated data when user clicks "Use" */
  onApply: (data: {
    caption: string;
    lyrics: string;
    bpm: string;
    keyscale: string;
    timesignature: string;
    duration: number;
    vocalLanguage: string;
    instrumental: boolean;
  }) => void;
}

export function LLMAssist({ onApply }: LLMAssistProps) {
  const { status } = useServiceStore();
  const gen = useGenerationStore();
  const { addToast } = useUIStore();
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [query, setQuery] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  const [vocalLanguage, setVocalLanguage] = useState('unknown');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Local overrides for LLM settings (initialized from store)
  const [temperature, setTemperature] = useState(gen.lmTemperature);
  const [topK, setTopK] = useState(gen.lmTopK);
  const [topP, setTopP] = useState(gen.lmTopP);
  const [useConstrained, setUseConstrained] = useState(true);
  const [constrainedDebug, setConstrainedDebug] = useState(gen.constrainedDecodingDebug);
  const [repetitionPenalty, setRepetitionPenalty] = useState(1.0);

  const llmReady = status.llm_initialized;

  const handleCreate = async () => {
    if (!llmReady || !query.trim()) return;
    setLoading(true);
    try {
      const resp = await api.createSample({
        query: query.trim(),
        instrumental,
        vocal_language: vocalLanguage === 'unknown' ? null : vocalLanguage,
        lm_temperature: temperature,
        lm_top_k: topK,
        lm_top_p: topP,
        use_constrained_decoding: useConstrained,
        constrained_decoding_debug: constrainedDebug,
        repetition_penalty: repetitionPenalty,
      });
      if (resp.success && resp.data) {
        setResult(resp.data);
        addToast('Sample created — review and click Use', 'success');
      }
    } catch (err: any) {
      addToast(err.message || 'Create sample failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!result) return;
    onApply({
      caption: result.caption || '',
      lyrics: result.lyrics || '',
      bpm: result.bpm ? String(result.bpm) : '',
      keyscale: result.keyscale || '',
      timesignature: result.timesignature || '',
      duration: result.duration || -1,
      vocalLanguage: result.language || 'unknown',
      instrumental: result.instrumental || false,
    });
    addToast('Applied to fields', 'success');
  };

  if (!llmReady) return null;

  return (
    <div className="card" style={{ borderColor: 'var(--accent)', borderWidth: '1px' }}>
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <h4 className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
          AI Assist
        </h4>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {open ? '\u25B2' : '\u25BC'}
        </span>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Describe what you want and the LLM will generate caption, lyrics, and metadata.
          </p>

          <AutoTextarea
            persistKey="llm-assist-query"
            minRows={2}
            maxRows={6}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. A melancholic piano ballad with soft female vocals about lost love"
            className="w-full"
          />

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={instrumental}
                onChange={(e) => setInstrumental(e.target.checked)}
                id="llm-assist-instrumental"
              />
              <label htmlFor="llm-assist-instrumental" className="text-xs cursor-pointer">
                Instrumental
              </label>
            </div>
            <select
              value={vocalLanguage}
              onChange={(e) => setVocalLanguage(e.target.value)}
              className="text-xs"
              style={{ width: '120px' }}
            >
              {VALID_LANGUAGES.map((l) => (
                <option key={l} value={l}>{LANGUAGE_NAMES[l] || l}</option>
              ))}
            </select>
          </div>

          {/* Advanced LLM Settings */}
          <div
            className="rounded px-3 py-2"
            style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
          >
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                LLM Sampler Settings
              </span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {showAdvanced ? '\u25B2' : '\u25BC'}
              </span>
            </div>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                {/* Temperature */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Temperature<Tooltip text={help.HELP_ASSIST_TEMPERATURE} /></label>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{temperature.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min={0} max={2} step={0.05}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  />
                </div>

                {/* Top-K */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Top-K<Tooltip text={help.HELP_ASSIST_TOP_K} /></label>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{topK}</span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value))}
                  />
                </div>

                {/* Top-P */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Top-P<Tooltip text={help.HELP_ASSIST_TOP_P} /></label>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{topP.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                  />
                </div>

                {/* Repetition Penalty */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Repetition Penalty<Tooltip text={help.HELP_ASSIST_REP_PENALTY} /></label>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{repetitionPenalty.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min={1.0} max={2.0} step={0.05}
                    value={repetitionPenalty}
                    onChange={(e) => setRepetitionPenalty(parseFloat(e.target.value))}
                  />
                </div>

                {/* Checkboxes */}
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox" id="llm-constrained"
                      checked={useConstrained}
                      onChange={(e) => setUseConstrained(e.target.checked)}
                    />
                    <label htmlFor="llm-constrained" className="text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                      Constrained Decoding<Tooltip text={help.HELP_ASSIST_CONSTRAINED} />
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox" id="llm-debug"
                      checked={constrainedDebug}
                      onChange={(e) => setConstrainedDebug(e.target.checked)}
                    />
                    <label htmlFor="llm-debug" className="text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                      Debug<Tooltip text={help.HELP_CONSTRAINED_DEBUG} />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            className="btn btn-primary btn-sm flex items-center gap-2"
            onClick={handleCreate}
            disabled={loading || !query.trim()}
          >
            {loading && <Spinner size="sm" />}
            {loading ? 'Generating...' : 'Create Sample'}
          </button>

          {/* Generated result preview */}
          {result && (
            <div className="space-y-2 p-3 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Caption</label>
                <p className="text-sm mt-0.5">{result.caption}</p>
              </div>
              {result.lyrics && (
                <div>
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Lyrics</label>
                  <pre className="text-xs mt-0.5 whitespace-pre-wrap font-mono" style={{ maxHeight: '150px', overflow: 'auto' }}>
                    {result.lyrics}
                  </pre>
                </div>
              )}
              <div className="flex gap-3 flex-wrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                {result.bpm && <span>BPM: {result.bpm}</span>}
                {result.keyscale && <span>Key: {result.keyscale}</span>}
                {result.duration && <span>Duration: {result.duration}s</span>}
                {result.timesignature && <span>Time: {result.timesignature}</span>}
                {result.language && <span>Lang: {result.language}</span>}
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleApply}
              >
                Use This
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
