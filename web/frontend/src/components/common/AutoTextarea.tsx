'use client';

import { useRef, useEffect, useCallback, useState, TextareaHTMLAttributes } from 'react';

const STORAGE_PREFIX = 'textarea-height:';

interface AutoTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> {
  /** Unique key for persisting height across sessions */
  persistKey?: string;
  /** Minimum rows (default 2) */
  minRows?: number;
  /** Maximum rows before scrolling (default 20) */
  maxRows?: number;
}

export function AutoTextarea({
  persistKey,
  minRows = 2,
  maxRows = 20,
  value,
  className,
  ...props
}: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [manualHeight, setManualHeight] = useState<number | null>(() => {
    if (!persistKey || typeof window === 'undefined') return null;
    const stored = localStorage.getItem(STORAGE_PREFIX + persistKey);
    return stored ? parseInt(stored, 10) : null;
  });
  const isManualRef = useRef(!!manualHeight);
  const lastAutoHeightRef = useRef<number>(0);
  // Only detect manual resize while user is actively dragging the resize handle
  const isDraggingRef = useRef(false);

  // Auto-resize based on content
  const autoResize = useCallback(() => {
    const el = ref.current;
    if (!el || isManualRef.current) return;

    // Temporarily reset to get scrollHeight
    el.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    const minH = lineHeight * minRows + 16; // 16 for padding
    const maxH = lineHeight * maxRows + 16;
    const contentH = Math.min(Math.max(el.scrollHeight, minH), maxH);
    el.style.height = contentH + 'px';
    lastAutoHeightRef.current = contentH;
  }, [minRows, maxRows]);

  // Resize on value change
  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  // Detect manual resize via ResizeObserver — only when user is dragging
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleMouseDown = () => { isDraggingRef.current = true; };
    const handleMouseUp = () => { isDraggingRef.current = false; };

    el.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    const observer = new ResizeObserver((entries) => {
      if (!isDraggingRef.current) return;
      for (const entry of entries) {
        const newH = Math.round(entry.contentRect.height + 16);
        if (Math.abs(newH - lastAutoHeightRef.current) > 4) {
          isManualRef.current = true;
          setManualHeight(newH);
          if (persistKey) {
            localStorage.setItem(STORAGE_PREFIX + persistKey, String(newH));
          }
        }
      }
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      el.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [persistKey]);

  // Apply manual height if set
  useEffect(() => {
    if (manualHeight && ref.current) {
      ref.current.style.height = manualHeight + 'px';
      isManualRef.current = true;
    }
  }, [manualHeight]);

  // Double-click the resize handle area to reset to auto-size
  const handleDoubleClick = useCallback(() => {
    isManualRef.current = false;
    setManualHeight(null);
    if (persistKey) {
      localStorage.removeItem(STORAGE_PREFIX + persistKey);
    }
    autoResize();
  }, [persistKey, autoResize]);

  return (
    <textarea
      ref={ref}
      value={value}
      className={className}
      style={{ resize: 'vertical', overflow: 'auto' }}
      onDoubleClick={handleDoubleClick}
      {...props}
    />
  );
}
