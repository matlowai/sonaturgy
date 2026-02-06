'use client';

import { useEffect, useState, useRef } from 'react';
import * as api from '@/lib/api';
import type { TrainingStatus } from '@/lib/types';

export function TrainingProgress() {
  const [status, setStatus] = useState<TrainingStatus>({
    running: false, epoch: 0, total_epochs: 0, loss: 0, progress: 0, losses: [],
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const poll = async () => {
      try {
        const resp = await api.getTrainingStatus();
        if (resp.success) setStatus(resp.data);
      } catch {}
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Draw loss chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status.losses.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const losses = status.losses;
    const maxLoss = Math.max(...losses, 0.001);
    const minLoss = Math.min(...losses, 0);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1b26';
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#2f3146';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = (h / 5) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Draw loss line
    ctx.strokeStyle = '#5c7cfa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    losses.forEach((loss, i) => {
      const x = (i / Math.max(losses.length - 1, 1)) * w;
      const y = h - ((loss - minLoss) / (maxLoss - minLoss || 1)) * h * 0.9 - h * 0.05;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [status.losses]);

  if (!status.running && status.losses.length === 0) return null;

  return (
    <div className="card space-y-3">
      <h2 className="section-title">Training Progress</h2>

      <div className="flex items-center gap-3">
        <span className={`badge ${status.running ? 'badge-success' : 'badge-info'}`}>
          {status.running ? 'Running' : 'Stopped'}
        </span>
        <span className="text-sm">
          Epoch {status.epoch} / {status.total_epochs}
        </span>
        <span className="text-sm">Loss: {status.loss.toFixed(4)}</span>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${status.progress * 100}%` }} />
      </div>

      {status.losses.length > 0 && (
        <div>
          <label className="label">Loss Curve</label>
          <canvas ref={canvasRef} width={400} height={150} className="w-full rounded" />
        </div>
      )}
    </div>
  );
}
