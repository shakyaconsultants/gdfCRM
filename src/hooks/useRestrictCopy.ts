'use client'

import { useEffect, useCallback, type ClipboardEvent, type MouseEvent } from 'react'

function isFormFieldTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false
  return !!target.closest('input, textarea, select, [contenteditable="true"]')
}

function isCopyAllowedTarget(target: EventTarget | null): boolean {
  if (isFormFieldTarget(target)) return true
  if (!target || !(target instanceof Element)) return false
  return !!target.closest('[data-allow-copy], .select-text')
}

/**
 * Discourages copying page content (e.g. lead PII). Selection and clipboard still work inside form controls.
 * Note: Determined users can bypass browser-only restrictions (DevTools, extensions, screenshots).
 */
export function useRestrictCopy() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isCopyAllowedTarget(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'c' || k === 'x' || k === 'a') {
        e.preventDefault()
      }
    }

    const onClipboard = (e: Event) => {
      if (isCopyAllowedTarget(e.target)) return
      e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('copy', onClipboard, true)
    window.addEventListener('cut', onClipboard, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('copy', onClipboard, true)
      window.removeEventListener('cut', onClipboard, true)
    }
  }, [])

  const onCopy = useCallback((e: ClipboardEvent<HTMLElement>) => {
    if (isCopyAllowedTarget(e.target)) return
    e.preventDefault()
  }, [])

  const onCut = useCallback((e: ClipboardEvent<HTMLElement>) => {
    if (isCopyAllowedTarget(e.target)) return
    e.preventDefault()
  }, [])

  const onContextMenu = useCallback((e: MouseEvent<HTMLElement>) => {
    if (isCopyAllowedTarget(e.target)) return
    e.preventDefault()
  }, [])

  return { onCopy, onCut, onContextMenu }
}
