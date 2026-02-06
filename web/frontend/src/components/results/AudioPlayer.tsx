'use client';

import { useEffect, useRef, useState } from 'react';

interface AudioPlayerProps {
  url: string;
}

export function AudioPlayer({ url }: AudioPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current || !url) return;

    let ws: any = null;

    const init = async () => {
      try {
        const WaveSurfer = (await import('wavesurfer.js')).default;
        ws = WaveSurfer.create({
          container: containerRef.current!,
          waveColor: '#5c7cfa',
          progressColor: '#4263eb',
          cursorColor: '#e1e2e8',
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 64,
          url,
          backend: 'WebAudio',
        });

        ws.on('ready', () => {
          setReady(true);
          setDuration(ws.getDuration());
        });
        ws.on('play', () => setPlaying(true));
        ws.on('pause', () => setPlaying(false));
        ws.on('timeupdate', (time: number) => setCurrentTime(time));
        ws.on('finish', () => setPlaying(false));

        wsRef.current = ws;
      } catch {
        // wavesurfer not available, fall back to plain audio
        setReady(true);
      }
    };

    init();

    return () => {
      ws?.destroy();
      wsRef.current = null;
    };
  }, [url]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    if (wsRef.current) {
      wsRef.current.playPause();
    }
  };

  return (
    <div>
      <div ref={containerRef} className="rounded overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      {!wsRef.current && url && (
        <audio src={url} controls className="w-full mt-1" style={{ height: '36px' }} />
      )}
      {wsRef.current && (
        <div className="flex items-center gap-2 mt-1">
          <button className="btn btn-secondary btn-sm" onClick={togglePlay}>
            {playing ? '\u23F8' : '\u25B6'}
          </button>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      )}
    </div>
  );
}
