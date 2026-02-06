'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePromptLibraryStore } from '@/stores/promptLibraryStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useUIStore } from '@/stores/uiStore';
import { Spinner } from '@/components/common/Spinner';
import * as api from '@/lib/api';

interface PromptLibraryProps {
  onApply?: (prompt: api.PromptEntry) => void;
}

export function PromptLibrary({ onApply }: PromptLibraryProps) {
  const store = usePromptLibraryStore();
  const pipe = usePipelineStore();
  const { addToast } = useUIStore();
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveGenres, setSaveGenres] = useState<string[]>([]);
  const [saveTags, setSaveTags] = useState<string[]>([]);
  const [saveMood, setSaveMood] = useState('');
  const [saveNotes, setSaveNotes] = useState('');

  // Load prompts and taxonomy on mount
  useEffect(() => {
    if (store.isOpen) {
      loadPrompts();
      loadTaxonomy();
    }
  }, [store.isOpen, store.searchQuery, store.selectedGenres, store.selectedTags, store.selectedMood]);

  const loadPrompts = async () => {
    store.setLoading(true);
    try {
      const resp = await api.listPrompts({
        search: store.searchQuery || undefined,
        genres: store.selectedGenres.length > 0 ? store.selectedGenres.join(',') : undefined,
        tags: store.selectedTags.length > 0 ? store.selectedTags.join(',') : undefined,
        mood: store.selectedMood || undefined,
      });
      if (resp.success) {
        store.setPrompts(resp.data.prompts, resp.data.total);
      }
    } catch (err) {
      console.error('Failed to load prompts:', err);
    } finally {
      store.setLoading(false);
    }
  };

  const loadTaxonomy = async () => {
    try {
      const resp = await api.getPromptTaxonomy();
      if (resp.success) {
        store.setTaxonomy(resp.data.genres, resp.data.tags, resp.data.moods);
      }
    } catch (err) {
      console.error('Failed to load taxonomy:', err);
    }
  };

  const handleApply = useCallback((prompt: api.PromptEntry) => {
    // Apply to pipeline store
    pipe.setField('caption', prompt.caption);
    pipe.setField('lyrics', prompt.lyrics);
    pipe.setField('instrumental', prompt.instrumental);
    pipe.setField('vocalLanguage', prompt.vocal_language);
    if (prompt.bpm) pipe.setField('bpm', String(prompt.bpm));
    pipe.setField('keyscale', prompt.keyscale);
    pipe.setField('timesignature', prompt.timesignature);
    pipe.setField('duration', prompt.duration);

    addToast(`Applied "${prompt.name}"`, 'success');
    store.setOpen(false);

    onApply?.(prompt);
  }, [pipe, addToast, store, onApply]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this prompt?')) return;
    try {
      await api.deletePrompt(id);
      store.removePrompt(id);
      addToast('Prompt deleted', 'success');
    } catch (err) {
      addToast('Failed to delete prompt', 'error');
    }
  };

  const handleSave = async () => {
    if (!saveName.trim()) {
      addToast('Please enter a name', 'error');
      return;
    }

    try {
      const resp = await api.savePrompt({
        name: saveName.trim(),
        caption: pipe.caption,
        lyrics: pipe.lyrics,
        instrumental: pipe.instrumental,
        vocal_language: pipe.vocalLanguage,
        bpm: pipe.bpm ? parseInt(pipe.bpm) : undefined,
        keyscale: pipe.keyscale,
        timesignature: pipe.timesignature,
        duration: pipe.duration,
        genres: saveGenres,
        tags: saveTags,
        mood: saveMood,
        notes: saveNotes,
      });

      if (resp.success) {
        store.addPrompt(resp.data);
        addToast(`Saved "${saveName}"`, 'success');
        setSaveModalOpen(false);
        setSaveName('');
        setSaveGenres([]);
        setSaveTags([]);
        setSaveMood('');
        setSaveNotes('');
      }
    } catch (err) {
      addToast('Failed to save prompt', 'error');
    }
  };

  if (!store.isOpen) {
    return (
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => store.setOpen(true)}
        title="Open Prompt Library"
      >
        Prompt Library
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-[var(--bg-primary)] rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col"
        style={{ border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-semibold">Prompt Library</h2>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                // Auto-generate name from caption (first 40 chars)
                const autoName = pipe.caption
                  ? pipe.caption.slice(0, 40).trim() + (pipe.caption.length > 40 ? '...' : '')
                  : '';
                setSaveName(autoName);
                setSaveModalOpen(true);
              }}
            >
              Save Current
            </button>
            <button
              className="text-xl px-2 hover:opacity-70"
              onClick={() => store.setOpen(false)}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--border)' }}>
          <input
            type="text"
            placeholder="Search prompts..."
            value={store.searchQuery}
            onChange={(e) => store.setSearchQuery(e.target.value)}
            className="w-full"
          />

          {/* Genre chips */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
              Genres
            </label>
            <div className="flex flex-wrap gap-1">
              {store.genres.slice(0, 15).map((genre) => (
                <button
                  key={genre}
                  className={`px-2 py-0.5 text-xs rounded ${
                    store.selectedGenres.includes(genre)
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)]'
                  }`}
                  onClick={() => store.toggleGenre(genre)}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>

          {/* Mood select */}
          <div className="flex items-center gap-4">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                Mood
              </label>
              <select
                value={store.selectedMood}
                onChange={(e) => store.setMood(e.target.value)}
                className="text-sm"
              >
                <option value="">Any</option>
                {store.moods.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {(store.selectedGenres.length > 0 || store.selectedTags.length > 0 || store.selectedMood) && (
              <button
                className="text-xs underline"
                style={{ color: 'var(--text-secondary)' }}
                onClick={() => store.clearFilters()}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Prompts list */}
        <div className="flex-1 overflow-y-auto p-4">
          {store.loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : store.prompts.length === 0 ? (
            <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
              No prompts found. Save your current settings to start building your library!
            </div>
          ) : (
            <div className="space-y-2">
              {store.prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="p-3 rounded border cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                  onClick={() => handleApply(prompt)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{prompt.name}</div>
                      <div className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                        {prompt.caption}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {prompt.bpm && <span>{prompt.bpm} BPM</span>}
                        {prompt.keyscale && <span>{prompt.keyscale}</span>}
                        {prompt.duration > 0 && <span>{prompt.duration}s</span>}
                        {prompt.instrumental && <span>Instrumental</span>}
                      </div>
                      {(prompt.genres.length > 0 || prompt.mood) && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {prompt.genres.map((g) => (
                            <span key={g} className="px-1.5 py-0.5 text-xs rounded bg-[var(--bg-secondary)]">
                              {g}
                            </span>
                          ))}
                          {prompt.mood && (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-[var(--accent)]/20">
                              {prompt.mood}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      className="text-xs px-2 py-1 hover:opacity-70"
                      style={{ color: 'var(--text-secondary)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(prompt.id);
                      }}
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          {store.total} prompt{store.total !== 1 ? 's' : ''} in library
        </div>
      </div>

      {/* Save Modal */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
          <div
            className="bg-[var(--bg-primary)] rounded-lg shadow-xl w-full max-w-md p-4 space-y-4"
            style={{ border: '1px solid var(--border)' }}
          >
            <h3 className="text-lg font-semibold">Save to Library</h3>

            <div>
              <label className="label">Name *</label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="My awesome prompt"
                className="w-full"
                autoFocus
              />
            </div>

            <div>
              <label className="label">Genres</label>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {store.genres.map((g) => (
                  <button
                    key={g}
                    className={`px-2 py-0.5 text-xs rounded ${
                      saveGenres.includes(g) ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)]'
                    }`}
                    onClick={() => setSaveGenres(
                      saveGenres.includes(g) ? saveGenres.filter((x) => x !== g) : [...saveGenres, g]
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Mood</label>
              <select
                value={saveMood}
                onChange={(e) => setSaveMood(e.target.value)}
                className="w-full"
              >
                <option value="">None</option>
                {store.moods.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Notes</label>
              <textarea
                value={saveNotes}
                onChange={(e) => setSaveNotes(e.target.value)}
                placeholder="Optional notes..."
                className="w-full h-16"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => setSaveModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
