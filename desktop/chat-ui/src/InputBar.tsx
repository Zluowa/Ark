// @input: onSend callback, disabled flag
// @output: Single-line input bar - brand dot, text input, send arrow
// @position: Leaf UI component - user input capture, fixed 36px height

import { forwardRef, useState, type KeyboardEvent } from 'react'

interface Props {
  onSend: (text: string) => void
  disabled: boolean
}

export const InputBar = forwardRef<HTMLInputElement, Props>(
  ({ onSend, disabled }, ref) => {
    const [text, setText] = useState('')

    const submit = () => {
      const trimmed = text.trim()
      if (!trimmed || disabled) return
      onSend(trimmed)
      setText('')
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    }

    return (
      <div className="input-container">
        <div className="input-field">
          <span className="brand-dot">*</span>
          <input
            ref={ref}
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            disabled={disabled}
          />
          {text.trim() && (
            <button
              className="send-btn"
              onClick={submit}
              disabled={disabled}
              title="Send (Enter)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    )
  },
)

InputBar.displayName = 'InputBar'
