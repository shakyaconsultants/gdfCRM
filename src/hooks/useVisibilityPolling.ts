'use client'

import { useEffect, useRef } from 'react'

type Options = {
  /** Poll interval when tab is visible (ms). Default 120_000 */
  intervalMs?: number
  /** Run once on mount. Default true */
  runOnMount?: boolean
  enabled?: boolean
}

/**
 * Runs callback on an interval only while the document tab is visible.
 * Pauses when hidden to cut server load on shared hosting.
 */
export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  deps: React.DependencyList,
  options: Options = {}
) {
  const { intervalMs = 120_000, runOnMount = true, enabled = true } = options
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    if (!enabled) return

    const run = () => {
      void cbRef.current()
    }

    if (runOnMount) run()

    let intervalId: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (intervalId) return
      intervalId = setInterval(run, intervalMs)
    }

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run()
        start()
      } else {
        stop()
      }
    }

    if (typeof document !== 'undefined') {
      if (document.visibilityState === 'visible') start()
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls deps
  }, [enabled, intervalMs, runOnMount, ...deps])
}
