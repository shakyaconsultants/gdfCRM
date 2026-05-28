'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

type Props = {
  value: string
  options: readonly string[]
  onSelect: (value: string) => void
  className?: string
}

/** Dropdown that fires onSelect even when the user picks the current value (native select does not). */
export default function DispositionSelect({ value, options, onSelect, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="w-full min-w-[8.5rem] max-w-[11rem] flex items-center justify-between gap-1 bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1.5 text-[11px] font-medium text-white focus:outline-none focus:ring-1 focus:ring-blue-500 select-text"
      >
        <span className="truncate text-left">{value}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-neutral-500" aria-hidden />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Disposition"
          className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full min-w-[8.5rem] overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
        >
          {options.map((d) => (
            <li key={d} role="option" aria-selected={d === value}>
              <button
                type="button"
                className={`w-full px-2 py-1.5 text-left text-[11px] hover:bg-neutral-800 ${
                  d === value ? 'bg-blue-950/40 text-blue-300 font-semibold' : 'text-neutral-200'
                }`}
                onClick={() => {
                  onSelect(d)
                  setOpen(false)
                }}
              >
                {d}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
