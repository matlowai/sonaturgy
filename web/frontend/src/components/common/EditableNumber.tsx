'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface EditableNumberProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

/**
 * A number display that becomes an input field when clicked.
 * Looks like plain text until you click it.
 */
export function EditableNumber({
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals = 0,
  className = '',
  prefix = '',
  suffix = '',
}: EditableNumberProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Format display value
  const displayValue = decimals > 0 ? value.toFixed(decimals) : String(value);

  // Start editing
  const startEdit = useCallback(() => {
    setInputValue(displayValue);
    setEditing(true);
  }, [displayValue]);

  // Commit the value
  const commit = useCallback(() => {
    let newValue = parseFloat(inputValue);

    if (isNaN(newValue)) {
      newValue = value; // Revert to original
    } else {
      // Clamp to min/max if provided
      if (min !== undefined) newValue = Math.max(min, newValue);
      if (max !== undefined) newValue = Math.min(max, newValue);

      // Round to step
      if (step) {
        newValue = Math.round(newValue / step) * step;
      }

      // Round to decimals
      if (decimals > 0) {
        newValue = parseFloat(newValue.toFixed(decimals));
      } else {
        newValue = Math.round(newValue);
      }
    }

    onChange(newValue);
    setEditing(false);
  }, [inputValue, value, min, max, step, decimals, onChange]);

  // Cancel editing
  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Handle key events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        min={min}
        max={max}
        step={step}
        className={`editable-number-input ${className}`}
        style={{
          width: `${Math.max(3, inputValue.length + 1)}ch`,
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--accent)',
          borderRadius: '3px',
          padding: '0 4px',
          fontSize: 'inherit',
          fontFamily: 'inherit',
          color: 'inherit',
          textAlign: 'center',
          outline: 'none',
        }}
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      className={`editable-number cursor-pointer hover:underline ${className}`}
      style={{ textDecoration: 'none' }}
      title="Click to edit"
    >
      {prefix}{displayValue}{suffix}
    </span>
  );
}
