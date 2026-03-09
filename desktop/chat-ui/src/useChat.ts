// @input: Tauri invoke (island IPC), fetch (backend SSE stream)
// @output: messages[], isStreaming, error, send()
// @position: Core domain logic — chat state machine

import { useState, useCallback, useRef } from 'react'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

async function invokeIsland(cmd: string, args: Record<string, unknown>): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke(cmd, args)
  } catch {
    // Not in Tauri context or island not connected
  }
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const snippetTimer = useRef<number>(0)

  const notifyIsland = useCallback((state: string) => {
    return invokeIsland('send_to_island', { msg: { type: 'ai_state_changed', state } })
  }, [])

  const sendSnippet = useCallback((text: string) => {
    const now = Date.now()
    if (now - snippetTimer.current < 200) return Promise.resolve()
    snippetTimer.current = now
    const truncated = text.length > 40 ? text.slice(-40) + '...' : text
    return invokeIsland('send_to_island', { msg: { type: 'chat_snippet', text: truncated } })
  }, [])

  const send = useCallback(async (text: string, filePaths?: string[]) => {
    setError(null)

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: buildUserContent(text, filePaths) }
    const nextMessages = [...messages, userMsg]

    setMessages([...nextMessages, { id: crypto.randomUUID(), role: 'assistant', content: '' }])
    setIsStreaming(true)
    await notifyIsland('streaming')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-omni-source': 'island',
        },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({
            id: m.id,
            role: m.role,
            parts: [{ type: 'text', text: m.content }],
          })),
        }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`API error: ${res.status}`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      await streamIntoMessages(reader, setMessages, sendSnippet)
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message || 'Failed to send message')
        setMessages(prev => appendErrorToLast(prev))
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      await notifyIsland('idle')
    }
  }, [messages, notifyIsland, sendSnippet])

  return { messages, isStreaming, error, send }
}

// ---- pure helpers ----

function buildUserContent(text: string, filePaths?: string[]): string {
  if (!filePaths || filePaths.length === 0) return text
  const fileList = filePaths
    .map(p => `[File: ${p.split(/[/\\]/).pop() ?? p}](${p})`)
    .join('\n')
  return `${fileList}\n\n${text}`
}

async function streamIntoMessages(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  sendSnippet: (text: string) => Promise<void>
) {
  const decoder = new TextDecoder()
  let accumulated = ''
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const evt = JSON.parse(line.slice(6))
        if (evt.type === 'text-delta' && typeof evt.delta === 'string') {
          accumulated += evt.delta
        }
      } catch { /* skip malformed */ }
    }

    setMessages(prev => replaceLastAssistant(prev, accumulated))
    await sendSnippet(accumulated)
  }
}

function replaceLastAssistant(prev: Message[], content: string): Message[] {
  const updated = [...prev]
  const last = updated[updated.length - 1]
  if (last?.role === 'assistant') {
    updated[updated.length - 1] = { ...last, content }
  }
  return updated
}

function appendErrorToLast(prev: Message[]): Message[] {
  const updated = [...prev]
  const last = updated[updated.length - 1]
  if (last?.role === 'assistant' && !last.content) {
    updated[updated.length - 1] = {
      ...last,
      content: 'Failed to get response. Check if OmniAgent server is running on localhost:3010.',
    }
  }
  return updated
}
