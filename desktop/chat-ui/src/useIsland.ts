// @input: Tauri event system + invoke API
// @output: droppedFiles[], clearFile(), collapse()
// @position: Island bridge — translates Tauri events into React state + actions

import { useState, useEffect, useCallback } from 'react'

export interface DroppedFile {
  path: string
  name: string
}

async function invokeCollapse() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('collapse_panel')
  } catch {
    // Not in Tauri context
  }
}

export function useIsland() {
  const [droppedFiles, setDroppedFiles] = useState<DroppedFile[]>([])

  useEffect(() => {
    const cleanup: Array<() => void> = []

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('focus-chat-input', () => {
        setTimeout(() => {
          const input = document.querySelector('.input-field input') as HTMLInputElement
          input?.focus()
        }, 100)
      }).then(unlisten => cleanup.push(unlisten))

      listen<string[]>('island-file-dropped', event => {
        console.log('[useIsland] file dropped:', event.payload)
        const files = event.payload.map(path => ({
          path,
          name: path.split(/[/\\]/).pop() ?? path,
        }))
        setDroppedFiles(prev => [...prev, ...files])
      }).then(unlisten => cleanup.push(unlisten))
    }).catch(() => {
      // Not in Tauri context — dev browser mode
    })

    return () => cleanup.forEach(fn => fn())
  }, [])

  const clearFile = useCallback((index?: number) => {
    setDroppedFiles(prev =>
      index !== undefined ? prev.filter((_, i) => i !== index) : []
    )
  }, [])

  const collapse = useCallback(() => {
    invokeCollapse()
  }, [])

  return { droppedFiles, clearFile, collapse }
}
