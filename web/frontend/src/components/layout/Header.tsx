'use client';

import { useUIStore } from '@/stores/uiStore';
import { useServiceStore } from '@/stores/serviceStore';
import type { Language } from '@/lib/i18n';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
];

export function Header() {
  const { language, setLanguage } = useUIStore();
  const { status } = useServiceStore();

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">ACE-Step V1.5</h1>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Open-Source Music Generation
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {status.dit_initialized ? (
            <span className="badge badge-success">DiT Ready</span>
          ) : (
            <span className="badge badge-error">DiT Off</span>
          )}
          {status.llm_initialized ? (
            <span className="badge badge-success">LLM Ready</span>
          ) : (
            <span className="badge badge-warning">LLM Off</span>
          )}
        </div>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          className="text-xs"
          style={{ width: '90px' }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
