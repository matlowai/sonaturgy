import { create } from 'zustand';

export interface Track {
  id: string;
  url: string;
  title: string;
  batchIndex?: number;
  audioIndex?: number;
}

interface PlayerState {
  // Current track
  currentTrack: Track | null;
  playlist: Track[];

  // Playback state
  playing: boolean;
  currentTime: number;
  duration: number;

  // WaveSurfer instance ref (managed by PlayerBar)
  wavesurferReady: boolean;

  // Actions
  setTrack: (track: Track) => void;
  setPlaylist: (tracks: Track[]) => void;
  addToPlaylist: (track: Track) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setWavesurferReady: (ready: boolean) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  playTrack: (track: Track) => void;
  stop: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  playlist: [],
  playing: false,
  currentTime: 0,
  duration: 0,
  wavesurferReady: false,

  setTrack: (track) => set({ currentTrack: track, currentTime: 0, duration: 0 }),

  setPlaylist: (tracks) => set({ playlist: tracks }),

  addToPlaylist: (track) => set((s) => {
    // Don't add duplicates
    if (s.playlist.some(t => t.id === track.id)) return s;
    return { playlist: [...s.playlist, track] };
  }),

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setPlaying: (playing) => set({ playing }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setWavesurferReady: (wavesurferReady) => set({ wavesurferReady }),

  nextTrack: () => {
    const { playlist, currentTrack } = get();
    if (!currentTrack || playlist.length === 0) return;
    const idx = playlist.findIndex(t => t.id === currentTrack.id);
    if (idx < playlist.length - 1) {
      set({ currentTrack: playlist[idx + 1], currentTime: 0, duration: 0, playing: true });
    }
  },

  prevTrack: () => {
    const { playlist, currentTrack } = get();
    if (!currentTrack || playlist.length === 0) return;
    const idx = playlist.findIndex(t => t.id === currentTrack.id);
    if (idx > 0) {
      set({ currentTrack: playlist[idx - 1], currentTime: 0, duration: 0, playing: true });
    }
  },

  playTrack: (track) => {
    const { playlist } = get();
    // Add to playlist if not already there
    if (!playlist.some(t => t.id === track.id)) {
      set((s) => ({ playlist: [...s.playlist, track] }));
    }
    set({ currentTrack: track, currentTime: 0, duration: 0, playing: true });
  },

  stop: () => set({ playing: false, currentTime: 0 }),
}));
