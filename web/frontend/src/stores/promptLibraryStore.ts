import { create } from 'zustand';
import type { PromptEntry } from '@/lib/api';

interface PromptLibraryState {
  // Data
  prompts: PromptEntry[];
  total: number;
  loading: boolean;

  // Taxonomy
  genres: string[];
  tags: string[];
  moods: string[];

  // Filters
  searchQuery: string;
  selectedGenres: string[];
  selectedTags: string[];
  selectedMood: string;

  // UI
  isOpen: boolean;

  // Actions
  setPrompts: (prompts: PromptEntry[], total: number) => void;
  setTaxonomy: (genres: string[], tags: string[], moods: string[]) => void;
  setLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  toggleGenre: (genre: string) => void;
  toggleTag: (tag: string) => void;
  setMood: (mood: string) => void;
  clearFilters: () => void;
  setOpen: (open: boolean) => void;
  addPrompt: (prompt: PromptEntry) => void;
  removePrompt: (id: string) => void;
}

export const usePromptLibraryStore = create<PromptLibraryState>((set) => ({
  prompts: [],
  total: 0,
  loading: false,

  genres: [],
  tags: [],
  moods: [],

  searchQuery: '',
  selectedGenres: [],
  selectedTags: [],
  selectedMood: '',

  isOpen: false,

  setPrompts: (prompts, total) => set({ prompts, total }),
  setTaxonomy: (genres, tags, moods) => set({ genres, tags, moods }),
  setLoading: (loading) => set({ loading }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  toggleGenre: (genre) => set((s) => ({
    selectedGenres: s.selectedGenres.includes(genre)
      ? s.selectedGenres.filter((g) => g !== genre)
      : [...s.selectedGenres, genre],
  })),

  toggleTag: (tag) => set((s) => ({
    selectedTags: s.selectedTags.includes(tag)
      ? s.selectedTags.filter((t) => t !== tag)
      : [...s.selectedTags, tag],
  })),

  setMood: (selectedMood) => set({ selectedMood }),

  clearFilters: () => set({
    searchQuery: '',
    selectedGenres: [],
    selectedTags: [],
    selectedMood: '',
  }),

  setOpen: (isOpen) => set({ isOpen }),

  addPrompt: (prompt) => set((s) => ({
    prompts: [prompt, ...s.prompts],
    total: s.total + 1,
  })),

  removePrompt: (id) => set((s) => ({
    prompts: s.prompts.filter((p) => p.id !== id),
    total: Math.max(0, s.total - 1),
  })),
}));
