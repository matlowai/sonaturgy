'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePlayerStore, Track } from '@/stores/playerStore';

export function PlayerBar() {
  const {
    currentTrack,
    playlist,
    playing,
    currentTime,
    duration,
    setPlaying,
    setCurrentTime,
    setDuration,
    nextTrack,
    prevTrack,
    playTrack,
  } = usePlayerStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<any>(null);
  const [wsReady, setWsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const currentUrlRef = useRef<string | null>(null);
  // Queue: if user clicks play before WaveSurfer is ready, store the URL to load
  const pendingUrlRef = useRef<string | null>(null);

  const hasContent = playlist.length > 0 || !!currentTrack;

  // Format time as m:ss
  const formatTime = (s: number) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Get current track index
  const currentIndex = currentTrack
    ? playlist.findIndex(t => t.id === currentTrack.id)
    : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < playlist.length - 1;

  // Initialize WaveSurfer once on mount (always rendered, just hidden)
  useEffect(() => {
    if (!containerRef.current || wsRef.current) return;

    let destroyed = false;

    const init = async () => {
      try {
        const WaveSurfer = (await import('wavesurfer.js')).default;
        if (destroyed || !containerRef.current) return;

        const ws = WaveSurfer.create({
          container: containerRef.current,
          waveColor: '#5c7cfa',
          progressColor: '#4263eb',
          cursorColor: '#e1e2e8',
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 48,
          normalize: true,
          interact: true,
        });

        ws.on('ready', () => {
          setLoading(false);
          setDuration(ws.getDuration());
          // Auto-play if store says playing
          if (usePlayerStore.getState().playing && !ws.isPlaying()) {
            ws.play().catch(() => {});
          }
        });

        ws.on('play', () => setPlaying(true));
        ws.on('pause', () => setPlaying(false));
        ws.on('timeupdate', (time: number) => setCurrentTime(time));
        ws.on('finish', () => {
          setPlaying(false);
          // Auto-advance
          const state = usePlayerStore.getState();
          const idx = state.playlist.findIndex(t => t.id === state.currentTrack?.id);
          if (idx >= 0 && idx < state.playlist.length - 1) {
            nextTrack();
          }
        });

        wsRef.current = ws;
        setWsReady(true);

        // If a track was requested before WaveSurfer was ready, load it now
        const pending = pendingUrlRef.current;
        if (pending) {
          pendingUrlRef.current = null;
          currentUrlRef.current = pending;
          setLoading(true);
          ws.load(pending);
        }
      } catch (e) {
        console.error('Failed to init WaveSurfer:', e);
      }
    };

    init();

    return () => {
      destroyed = true;
      if (wsRef.current) {
        wsRef.current.destroy();
        wsRef.current = null;
        setWsReady(false);
      }
    };
  }, [setDuration, setPlaying, setCurrentTime, nextTrack]);

  // Load new track when currentTrack changes
  useEffect(() => {
    const url = currentTrack?.url;
    if (!url) return;

    // Skip if same URL already loaded
    if (currentUrlRef.current === url) return;

    if (!wsRef.current || !wsReady) {
      // WaveSurfer not ready yet - queue the URL
      pendingUrlRef.current = url;
      return;
    }

    currentUrlRef.current = url;
    setLoading(true);
    wsRef.current.load(url);
  }, [currentTrack?.url, currentTrack?.id, wsReady]);

  // Sync play/pause state with WaveSurfer
  useEffect(() => {
    if (!wsReady || !wsRef.current || loading) return;

    const ws = wsRef.current;
    const isWsPlaying = ws.isPlaying?.() ?? false;

    if (playing && !isWsPlaying) {
      ws.play().catch((e: any) => {
        console.error('Play failed:', e);
      });
    } else if (!playing && isWsPlaying) {
      ws.pause();
    }
  }, [playing, wsReady, loading]);

  // Handle play/pause click
  const handleTogglePlay = useCallback(() => {
    if (!currentTrack) return;
    if (wsRef.current && wsReady && !loading) {
      wsRef.current.playPause();
    } else {
      setPlaying(!playing);
    }
  }, [currentTrack, wsReady, loading, playing, setPlaying]);

  // Handle playlist item click
  const handlePlaylistClick = (track: Track) => {
    playTrack(track);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!currentTrack) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === 'ArrowLeft' && e.ctrlKey) {
        e.preventDefault();
        prevTrack();
      } else if (e.code === 'ArrowRight' && e.ctrlKey) {
        e.preventDefault();
        nextTrack();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleTogglePlay, prevTrack, nextTrack, currentTrack]);

  return (
    <>
      {/* Playlist Panel */}
      {hasContent && showPlaylist && playlist.length > 0 && (
        <div
          className="fixed bottom-[72px] right-4 z-40 rounded-t-lg shadow-lg overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderBottom: 'none',
            width: '320px',
            maxHeight: '400px',
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-sm font-medium">Playlist ({playlist.length})</span>
            <button
              onClick={() => setShowPlaylist(false)}
              className="text-xs px-2 py-1 rounded hover:opacity-70"
              style={{ color: 'var(--text-secondary)' }}
            >
              &times;
            </button>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '350px' }}>
            {playlist.map((track, idx) => (
              <div
                key={track.id}
                onClick={() => handlePlaylistClick(track)}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-opacity-50 transition-colors"
                style={{
                  backgroundColor: track.id === currentTrack?.id ? 'var(--accent-muted, rgba(66, 99, 235, 0.15))' : 'transparent',
                }}
              >
                <span
                  className="w-6 h-6 flex items-center justify-center rounded-full text-xs flex-shrink-0"
                  style={{
                    backgroundColor: track.id === currentTrack?.id ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: track.id === currentTrack?.id ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  {track.id === currentTrack?.id && playing ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </span>
                <span className="text-sm truncate flex-1" title={track.title}>
                  {track.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Player Bar - always rendered, hidden when no tracks */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
          height: '72px',
        }}
      >
        <div className="h-full flex items-center gap-3 px-4">
          {/* Transport controls */}
          <div className="flex items-center gap-1">
            <button
              className="p-2 rounded hover:opacity-70 transition-opacity"
              style={{ color: hasPrev ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              onClick={prevTrack}
              disabled={!hasPrev}
              title="Previous (Ctrl+Left)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              </svg>
            </button>
            <button
              className="p-3 rounded-full transition-transform hover:scale-105"
              style={{ backgroundColor: 'var(--accent)', color: 'white' }}
              onClick={handleTogglePlay}
              disabled={!currentTrack}
              title="Play/Pause (Space)"
            >
              {loading ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="animate-spin">
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity="0.3"/>
                  <path d="M12 4V2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8z"/>
                </svg>
              ) : playing ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>
            <button
              className="p-2 rounded hover:opacity-70 transition-opacity"
              style={{ color: hasNext ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              onClick={nextTrack}
              disabled={!hasNext}
              title="Next (Ctrl+Right)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
          </div>

          {/* Time */}
          <span className="text-xs font-mono w-10 text-right flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {formatTime(currentTime)}
          </span>

          {/* Waveform - WaveSurfer handles its own click-to-seek via interact:true */}
          <div
            ref={containerRef}
            className="flex-1 rounded min-w-0"
            style={{ backgroundColor: 'var(--bg-tertiary)', minHeight: '48px' }}
          />

          {/* Duration */}
          <span className="text-xs font-mono w-10 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {formatTime(duration)}
          </span>

          {/* Track info & playlist toggle */}
          <div className="flex items-center gap-2 min-w-0 max-w-56">
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate" title={currentTrack?.title || 'No track'}>
                {currentTrack?.title || 'No track selected'}
              </span>
              {playlist.length > 0 && (
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {currentIndex >= 0 ? `${currentIndex + 1} / ${playlist.length}` : `${playlist.length} tracks`}
                </span>
              )}
            </div>
            {playlist.length > 0 && (
              <button
                onClick={() => setShowPlaylist(!showPlaylist)}
                className="p-2 rounded hover:opacity-70 transition-opacity flex-shrink-0"
                style={{ color: showPlaylist ? 'var(--accent)' : 'var(--text-secondary)' }}
                title="Toggle playlist"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
