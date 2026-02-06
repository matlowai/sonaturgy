'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions';
import * as api from '@/lib/api';

interface AudioSourceViewerProps {
  audioId: string;
  showRegion?: boolean;
  regionStart?: number;
  regionEnd?: number;
  onRegionChange?: (start: number, end: number) => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

export function AudioSourceViewer({
  audioId,
  showRegion,
  regionStart = 0,
  regionEnd = -1,
  onRegionChange,
}: AudioSourceViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const regionRef = useRef<Region | null>(null);
  const readyRef = useRef(false);
  const hasPlayedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !audioId) return;
    hasPlayedRef.current = false;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(150, 150, 180, 0.5)',
      progressColor: 'var(--accent)',
      cursorColor: 'var(--accent)',
      height: 80,
      minPxPerSec: 1,
      interact: !showRegion,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
    });

    let regions: RegionsPlugin | null = null;
    if (showRegion) {
      regions = ws.registerPlugin(RegionsPlugin.create());
      regionsRef.current = regions;
    }

    ws.load(api.getAudioUrl(audioId));

    ws.on('ready', () => {
      readyRef.current = true;
      setDuration(ws.getDuration());

      const container = containerRef.current;
      if (container) {
        const fitZoom = container.clientWidth / ws.getDuration();
        ws.zoom(Math.max(1, fitZoom));
      }

      if (showRegion && regions) {
        const dur = ws.getDuration();
        const end = regionEnd < 0 ? dur : Math.min(regionEnd, dur);
        const start = Math.max(0, regionStart);
        const r = regions.addRegion({
          start,
          end,
          color: 'rgba(255, 80, 80, 0.18)',
          drag: true,
          resize: true,
        });
        regionRef.current = r;
        r.on('update-end', () => {
          onRegionChange?.(
            Math.round(r.start * 100) / 100,
            Math.round(r.end * 100) / 100,
          );
        });
      }
    });

    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('finish', () => setPlaying(false));
    ws.on('timeupdate', (t) => setCurrentTime(t));

    if (!showRegion) {
      ws.on('click', () => {
        ws.isPlaying() ? ws.pause() : ws.play();
      });
    }

    wsRef.current = ws;

    return () => {
      readyRef.current = false;
      regionRef.current = null;
      regionsRef.current = null;
      ws.destroy();
      wsRef.current = null;
      setPlaying(false);
      setCurrentTime(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioId, showRegion]);

  // Sync region from external number input changes
  useEffect(() => {
    const r = regionRef.current;
    const ws = wsRef.current;
    if (!r || !ws || !readyRef.current) return;
    const dur = ws.getDuration();
    const newEnd = regionEnd < 0 ? dur : Math.min(regionEnd, dur);
    const newStart = Math.max(0, Math.min(regionStart, newEnd));
    if (Math.abs(r.start - newStart) > 0.05 || Math.abs(r.end - newEnd) > 0.05) {
      r.setOptions({ start: newStart, end: newEnd });
    }
  }, [regionStart, regionEnd]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const ws = wsRef.current;
    if (!ws || !containerRef.current) return;
    const current = ws.options.minPxPerSec ?? 30;
    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    const minZoom = containerRef.current.clientWidth / ws.getDuration();
    ws.zoom(Math.max(minZoom, Math.min(500, current * factor)));
  }, []);

  // Transport actions
  const playPause = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (ws.isPlaying()) {
      ws.pause();
    } else {
      // First play starts at mask start (if region exists and never played)
      if (!hasPlayedRef.current && regionRef.current) {
        ws.setTime(regionRef.current.start);
      }
      hasPlayedRef.current = true;
      ws.play();
    }
  }, []);

  const seekStart = useCallback(() => {
    const ws = wsRef.current;
    if (ws) ws.setTime(0);
  }, []);

  const seekMaskStart = useCallback(() => {
    const ws = wsRef.current;
    const r = regionRef.current;
    if (ws && r) ws.setTime(r.start);
  }, []);

  const seekBack5 = useCallback(() => {
    const ws = wsRef.current;
    if (ws) ws.setTime(Math.max(0, ws.getCurrentTime() - 5));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === ' ') { e.preventDefault(); playPause(); }
    if (e.key === 'Home') { e.preventDefault(); seekStart(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); seekBack5(); }
  }, [playPause, seekStart, seekBack5]);

  if (!audioId) return null;

  const btnStyle = {
    color: 'var(--text-primary)',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '11px',
    cursor: 'pointer',
    lineHeight: '1.4',
  };

  // Progress bar percentage
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="audio-source-viewer mt-2" tabIndex={0} onKeyDown={handleKeyDown} style={{ outline: 'none' }}>
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className="rounded-t overflow-hidden"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)', borderBottom: 'none' }}
      />

      {/* Progress bar */}
      <div style={{ height: '3px', backgroundColor: 'var(--bg-tertiary)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
        <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--accent)', transition: 'width 0.1s linear' }} />
      </div>

      {/* Transport controls */}
      <div
        className="flex items-center gap-1 px-2 py-1 rounded-b"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', borderTop: 'none' }}
      >
        <button onClick={seekStart} style={btnStyle} title="Go to start of track">
          &#9198;
        </button>
        {showRegion && (
          <button onClick={seekMaskStart} style={btnStyle} title="Go to start of mask">
            &#9194;
          </button>
        )}
        <button onClick={seekBack5} style={btnStyle} title="Back 5 seconds">
          &#9664;
        </button>
        <button onClick={playPause} style={{ ...btnStyle, minWidth: '28px' }} title="Play / Pause">
          {playing ? '\u23F8' : '\u25B6'}
        </button>

        <span className="text-[10px] font-mono ml-2" style={{ color: 'var(--text-secondary)' }}>
          {fmt(currentTime)} / {fmt(duration)}
        </span>

        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-secondary)' }}>
          {showRegion ? 'Drag handles = mask' : ''} · Scroll = zoom
        </span>
      </div>
    </div>
  );
}
