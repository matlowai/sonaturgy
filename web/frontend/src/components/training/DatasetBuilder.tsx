'use client';

import { useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import * as api from '@/lib/api';
import { AutoTextarea } from '@/components/common/AutoTextarea';

export function DatasetBuilder() {
  const { addToast } = useUIStore();
  const [directory, setDirectory] = useState('');
  const [datasetPath, setDatasetPath] = useState('');
  const [savePath, setSavePath] = useState('');
  const [samples, setSamples] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>({});

  const handleScan = async () => {
    if (!directory.trim()) return;
    try {
      const resp = await api.scanDataset(directory);
      if (resp.success) {
        setCount(resp.data.count);
        addToast(`Scanned ${resp.data.count} files`, 'success');
        fetchSamples();
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleLoad = async () => {
    if (!datasetPath.trim()) return;
    try {
      const resp = await api.loadDataset(datasetPath);
      if (resp.success) {
        setCount(resp.data.count);
        addToast(`Loaded ${resp.data.count} samples`, 'success');
        fetchSamples();
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const fetchSamples = async () => {
    try {
      const resp = await api.getDatasetSamples();
      if (resp.success) setSamples(resp.data);
    } catch {}
  };

  const handleAutoLabel = async () => {
    try {
      await api.autoLabel();
      addToast('Auto-labeling complete', 'success');
      fetchSamples();
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleSave = async () => {
    if (!savePath.trim()) return;
    try {
      await api.saveDataset(savePath);
      addToast('Dataset saved', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleEditSave = async () => {
    if (editIdx === null) return;
    try {
      await api.editSample(editIdx, editData);
      addToast('Sample updated', 'success');
      setEditIdx(null);
      fetchSamples();
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  return (
    <div className="card space-y-3">
      <h2 className="section-title">Dataset Builder</h2>

      {/* Scan directory */}
      <div>
        <label className="label">Audio Directory</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="/path/to/audio/files"
            className="flex-1"
          />
          <button className="btn btn-primary btn-sm" onClick={handleScan}>Scan</button>
        </div>
      </div>

      {/* Load existing */}
      <div>
        <label className="label">Load Existing Dataset</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={datasetPath}
            onChange={(e) => setDatasetPath(e.target.value)}
            placeholder="/path/to/dataset.json"
            className="flex-1"
          />
          <button className="btn btn-secondary btn-sm" onClick={handleLoad}>Load</button>
        </div>
      </div>

      {count > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm">{count} samples</span>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={handleAutoLabel}>Auto-Label</button>
            </div>
          </div>

          {/* Sample list */}
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {samples.map((sample, idx) => (
              <div key={idx} className="p-2 rounded text-xs space-y-1" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <div className="flex justify-between">
                  <span className="font-medium">Sample {idx + 1}</span>
                  <button
                    className="text-xs underline"
                    style={{ color: 'var(--accent)' }}
                    onClick={() => { setEditIdx(idx); setEditData(sample); }}
                  >
                    Edit
                  </button>
                </div>
                {sample.caption && <div><strong>Caption:</strong> {sample.caption}</div>}
                {sample.bpm && <span className="mr-2">BPM: {sample.bpm}</span>}
                {sample.keyscale && <span className="mr-2">Key: {sample.keyscale}</span>}
              </div>
            ))}
          </div>

          {/* Edit modal */}
          {editIdx !== null && (
            <div className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--accent)' }}>
              <h4 className="text-sm font-medium">Edit Sample {editIdx + 1}</h4>
              <div>
                <label className="label">Caption</label>
                <AutoTextarea
                  persistKey="dataset-caption"
                  minRows={2}
                  maxRows={10}
                  value={editData.caption || ''}
                  onChange={(e) => setEditData({ ...editData, caption: e.target.value })}
                  className="w-full"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label">BPM</label>
                  <input
                    type="number"
                    value={editData.bpm || ''}
                    onChange={(e) => setEditData({ ...editData, bpm: parseInt(e.target.value) || null })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="label">Key</label>
                  <input
                    type="text"
                    value={editData.keyscale || ''}
                    onChange={(e) => setEditData({ ...editData, keyscale: e.target.value })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="label">Language</label>
                  <input
                    type="text"
                    value={editData.vocal_language || ''}
                    onChange={(e) => setEditData({ ...editData, vocal_language: e.target.value })}
                    className="w-full"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary btn-sm" onClick={handleEditSave}>Save</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditIdx(null)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Save dataset */}
          <div>
            <label className="label">Save Dataset</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="/path/to/save/dataset.json"
                className="flex-1"
              />
              <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
