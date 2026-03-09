// @input: useChat (messages/streaming/send/error), useIsland (dropped files, collapse)
// @output: Tool-enhanced panel — quick actions, optional file chips, input bar, response cards
// @position: Composition root for expanded island panel

import { useRef, useEffect, useCallback, useState } from 'react'
import { InputBar } from './InputBar'
import { FileChip } from './FileChip'
import { SearchResultCard } from './SearchResultCard'
import { useChat } from './useChat'
import { useIsland } from './useIsland'

type QuickTool = {
  id: string
  label: string
  icon: string
  params: Record<string, unknown>
}

const QUICK_TOOLS: QuickTool[] = [
  { id: 'generate.uuid', label: 'UUID', icon: 'ID', params: { count: 1 } },
  { id: 'generate.timestamp', label: 'Time', icon: 'TS', params: { format: 'iso' } },
  { id: 'hash.sha256', label: 'SHA256', icon: 'H#', params: { input: 'OmniAgent' } },
  { id: 'encode.base64', label: 'Base64', icon: '64', params: { input: 'OmniAgent' } },
  { id: 'net.dns_lookup', label: 'DNS', icon: 'DNS', params: { domain: 'openai.com', type: 'A' } },
  { id: 'net.ip_info', label: 'IP', icon: 'IP', params: { ip: '8.8.8.8' } },
  { id: 'generate.qrcode', label: 'QR', icon: 'QR', params: { text: 'https://omniagent.ai', size: 240 } },
]

export function ChatPanel() {
  const { messages, isStreaming, send, error } = useChat()
  const { droppedFiles, clearFile, collapse } = useIsland()
  const inputRef = useRef<HTMLInputElement>(null)
  const [toolBusyId, setToolBusyId] = useState<string | null>(null)
  const [toolError, setToolError] = useState<string | null>(null)
  const [toolOutput, setToolOutput] = useState<string | null>(null)
  const [toolDownloadUrl, setToolDownloadUrl] = useState<string | null>(null)

  const lastReply = messages.filter(m => m.role === 'assistant').at(-1)?.content ?? null
  const searchCard = !error && lastReply ? <SearchResultCard text={lastReply} /> : null

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapse])

  const handleSend = useCallback((text: string) => {
    send(text, droppedFiles.map(f => f.path))
    clearFile()
  }, [droppedFiles, send, clearFile])

  const runQuickTool = useCallback(async (tool: QuickTool) => {
    setToolBusyId(tool.id)
    setToolError(null)
    setToolOutput(null)
    setToolDownloadUrl(null)
    await sendIslandToolProgress(tool.id, tool.label, 0.2, 'running')

    try {
      const res = await fetch('/api/v1/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: tool.id, params: tool.params }),
      })
      const data = await res.json()
      if (!res.ok || data?.status !== 'success') {
        const msg = data?.error?.message || `Tool failed (${res.status})`
        throw new Error(msg)
      }

      const result = data?.result ?? {}
      setToolOutput(formatToolOutput(tool.label, result))
      const fileUrl = extractFileUrl(result)
      if (fileUrl) {
        setToolDownloadUrl(normalizeUrl(fileUrl))
      }
      await sendIslandToolProgress(tool.id, tool.label, 1, 'complete')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Quick tool failed'
      setToolError(msg)
      await sendIslandToolProgress(tool.id, tool.label, 1, 'error')
    } finally {
      setToolBusyId(null)
    }
  }, [])

  return (
    <div className="chat-panel">
      <div className="tool-row">
        {QUICK_TOOLS.map(tool => (
          <button
            key={tool.id}
            className="tool-chip"
            onClick={() => runQuickTool(tool)}
            disabled={isStreaming || !!toolBusyId}
            title={tool.id}
          >
            <span className="tool-chip-icon">{tool.icon}</span>
            <span>{tool.label}</span>
            {toolBusyId === tool.id ? <span className="tool-chip-busy">...</span> : null}
          </button>
        ))}
      </div>

      {droppedFiles.length > 0 && (
        <div className="file-row">
          {droppedFiles.map((f, i) => (
            <FileChip key={i} name={f.name} onRemove={() => clearFile(i)} />
          ))}
        </div>
      )}

      <InputBar ref={inputRef} onSend={handleSend} disabled={isStreaming} />

      {toolError ? <div className="tool-result error-reply">{toolError}</div> : null}
      {toolOutput ? (
        <div className="tool-result">
          <span>{toolOutput}</span>
          {toolDownloadUrl ? (
            <a className="tool-download" href={toolDownloadUrl} target="_blank" rel="noreferrer">
              Download
            </a>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="last-reply error-reply">{error}</div>
      ) : searchCard ? (
        searchCard
      ) : lastReply ? (
        <div className="last-reply">{lastReply}</div>
      ) : null}
    </div>
  )
}

async function sendIslandToolProgress(
  toolId: string,
  name: string,
  progress: number,
  status: 'running' | 'complete' | 'error',
) {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('send_to_island', {
      msg: {
        type: 'tool_progress',
        tool_id: toolId,
        name,
        icon: 'wrench',
        progress,
        status,
      },
    })
  } catch {
    // dev browser mode or island bridge unavailable
  }
}

function formatToolOutput(label: string, result: Record<string, unknown>): string {
  const text = result?.text
  if (typeof text === 'string' && text.trim()) {
    const trimmed = text.trim()
    return `${label}: ${trimmed.length > 140 ? `${trimmed.slice(0, 140)}...` : trimmed}`
  }
  return `${label}: ${JSON.stringify(result)}`
}

function extractFileUrl(result: Record<string, unknown>): string | null {
  const direct = ['output_file_url', 'output_url', 'file_url', 'download_url', 'url']
  for (const key of direct) {
    const value = result[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return null
}

function normalizeUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return url.startsWith('/') ? url : `/${url}`
}
