'use client';

import { useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import * as api from '@/lib/api';

export function TrainingForm() {
  const { addToast } = useUIStore();
  const [config, setConfig] = useState({
    dataset_path: '',
    output_dir: '',
    rank: 16,
    alpha: 16,
    dropout: 0.0,
    learning_rate: 0.0001,
    epochs: 100,
    batch_size: 1,
    gradient_accumulation_steps: 4,
    save_interval: 10,
    shift: 3.0,
    seed: 42,
  });
  const [preprocessDir, setPreprocessDir] = useState('');
  const [exportCheckpoint, setExportCheckpoint] = useState('');
  const [exportOutput, setExportOutput] = useState('');

  const handlePreprocess = async () => {
    if (!preprocessDir.trim()) return;
    try {
      await api.preprocessDataset(preprocessDir);
      addToast('Preprocessing complete', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleStart = async () => {
    if (!config.dataset_path || !config.output_dir) {
      addToast('Please set dataset path and output directory', 'error');
      return;
    }
    try {
      await api.startTraining(config);
      addToast('Training started', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleStop = async () => {
    try {
      await api.stopTraining();
      addToast('Training stopped', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleExport = async () => {
    if (!exportCheckpoint || !exportOutput) return;
    try {
      await api.exportLoRA(exportCheckpoint, exportOutput);
      addToast('LoRA exported', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const setField = (key: string, value: any) => setConfig((c) => ({ ...c, [key]: value }));

  return (
    <div className="card space-y-3">
      <h2 className="section-title">Training Configuration</h2>

      {/* Preprocess */}
      <div>
        <label className="label">Preprocess Output Dir</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={preprocessDir}
            onChange={(e) => setPreprocessDir(e.target.value)}
            placeholder="/path/to/tensors"
            className="flex-1"
          />
          <button className="btn btn-secondary btn-sm" onClick={handlePreprocess}>Preprocess</button>
        </div>
      </div>

      {/* Training config */}
      <div>
        <label className="label">Dataset Path</label>
        <input type="text" value={config.dataset_path} onChange={(e) => setField('dataset_path', e.target.value)} className="w-full" placeholder="dataset.json" />
      </div>
      <div>
        <label className="label">Output Directory</label>
        <input type="text" value={config.output_dir} onChange={(e) => setField('output_dir', e.target.value)} className="w-full" placeholder="output/lora" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Rank</label>
          <input type="number" value={config.rank} onChange={(e) => setField('rank', parseInt(e.target.value))} className="w-full" />
        </div>
        <div>
          <label className="label">Alpha</label>
          <input type="number" value={config.alpha} onChange={(e) => setField('alpha', parseInt(e.target.value))} className="w-full" />
        </div>
        <div>
          <label className="label">Dropout</label>
          <input type="number" value={config.dropout} onChange={(e) => setField('dropout', parseFloat(e.target.value))} step={0.01} className="w-full" />
        </div>
        <div>
          <label className="label">Learning Rate</label>
          <input type="number" value={config.learning_rate} onChange={(e) => setField('learning_rate', parseFloat(e.target.value))} step={0.00001} className="w-full" />
        </div>
        <div>
          <label className="label">Epochs</label>
          <input type="number" value={config.epochs} onChange={(e) => setField('epochs', parseInt(e.target.value))} className="w-full" />
        </div>
        <div>
          <label className="label">Batch Size</label>
          <input type="number" value={config.batch_size} onChange={(e) => setField('batch_size', parseInt(e.target.value))} className="w-full" />
        </div>
        <div>
          <label className="label">Grad Accum</label>
          <input type="number" value={config.gradient_accumulation_steps} onChange={(e) => setField('gradient_accumulation_steps', parseInt(e.target.value))} className="w-full" />
        </div>
        <div>
          <label className="label">Save Interval</label>
          <input type="number" value={config.save_interval} onChange={(e) => setField('save_interval', parseInt(e.target.value))} className="w-full" />
        </div>
        <div>
          <label className="label">Seed</label>
          <input type="number" value={config.seed} onChange={(e) => setField('seed', parseInt(e.target.value))} className="w-full" />
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={handleStart}>Start Training</button>
        <button className="btn btn-secondary" onClick={handleStop}>Stop</button>
      </div>

      {/* Export */}
      <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-sm font-medium mb-2">Export LoRA</h3>
        <div className="grid grid-cols-2 gap-2">
          <input type="text" value={exportCheckpoint} onChange={(e) => setExportCheckpoint(e.target.value)} placeholder="Checkpoint path" className="w-full" />
          <input type="text" value={exportOutput} onChange={(e) => setExportOutput(e.target.value)} placeholder="Output path" className="w-full" />
        </div>
        <button className="btn btn-secondary btn-sm mt-2" onClick={handleExport}>Export</button>
      </div>
    </div>
  );
}
