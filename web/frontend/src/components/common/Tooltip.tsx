'use client';

import { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  text: string;
  /** Optional inline style override */
  className?: string;
}

/**
 * Hover/click (?) icon that shows a popover with help text.
 * Positions itself above, below, left, or right to stay in viewport.
 */
export function Tooltip({ text, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reposition if clipped
  useEffect(() => {
    if (!open || !popRef.current) return;
    const rect = popRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      popRef.current.style.left = 'auto';
      popRef.current.style.right = '0';
    }
    if (rect.bottom > window.innerHeight - 8) {
      popRef.current.style.top = 'auto';
      popRef.current.style.bottom = '100%';
      popRef.current.style.marginBottom = '6px';
    }
  }, [open]);

  return (
    <span
      ref={ref}
      className={`inline-flex items-center ${className || ''}`}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center rounded-full text-[10px] leading-none font-medium cursor-help select-none"
        style={{
          width: '14px',
          height: '14px',
          backgroundColor: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          marginLeft: '4px',
        }}
        aria-label="Help"
      >
        ?
      </button>
      {open && (
        <div
          ref={popRef}
          className="text-xs leading-relaxed rounded-md shadow-lg"
          style={{
            position: 'absolute',
            top: '100%',
            left: '0',
            marginTop: '6px',
            padding: '8px 10px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            zIndex: 50,
            maxWidth: '280px',
            minWidth: '180px',
            whiteSpace: 'pre-wrap',
            pointerEvents: 'auto',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
