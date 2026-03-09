import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, CheckCircle2, Loader2, MessageSquare, Reply, X } from 'lucide-react'
import { StandardIsland } from './StandardIsland'

type Phase = 'unread' | 'composing' | 'replying' | 'sent' | 'typing'

export function NotificationIsland() {
  const [expanded, setExpanded] = useState(false)
  const [phase, setPhase] = useState<Phase>('unread')
  const [replyText, setReplyText] = useState('')
  const [messageIndex, setMessageIndex] = useState(0)
  const timers = useRef<number[]>([])

  const messages = [
    "Can you review the latest Figma designs? I've updated the auto-layout.",
    "Awesome, thanks! I'll check it out right now.",
    'Looks perfect. Ready for handoff!',
  ]

  useEffect(() => {
    return () => {
      timers.current.forEach(window.clearTimeout)
      timers.current = []
    }
  }, [])

  const pushTimer = (cb: () => void, delay: number) => {
    const id = window.setTimeout(cb, delay)
    timers.current.push(id)
  }

  const handleReplyClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPhase('composing')
  }

  const handleSend = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation()
    if (!replyText.trim()) return

    setPhase('replying')
    setExpanded(false)

    pushTimer(() => {
      setPhase('sent')
      pushTimer(() => {
        setPhase('typing')
        pushTimer(() => {
          setMessageIndex(prev => (prev + 1) % messages.length)
          setPhase('unread')
          setReplyText('')
          setExpanded(true)
        }, 3000)
      }, 1500)
    }, 1500)
  }

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(false)
  }

  const getCompactContent = () => {
    if (phase === 'typing') {
      return {
        leading: (
          <div className="notif-compact-leading">
            <img
              src="https://picsum.photos/seed/sarah/100/100"
              alt="Avatar"
              className="notif-avatar notif-avatar-sm"
              referrerPolicy="no-referrer"
            />
          </div>
        ),
        trailing: (
          <div className="notif-typing-row">
            <motion.span
              className="notif-dot notif-dot-accent"
              animate={{ y: [0, -3, 0] }}
              transition={{ repeat: Infinity, duration: 0.8, delay: 0 }}
            />
            <motion.span
              className="notif-dot notif-dot-accent"
              animate={{ y: [0, -3, 0] }}
              transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }}
            />
            <motion.span
              className="notif-dot notif-dot-accent"
              animate={{ y: [0, -3, 0] }}
              transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }}
            />
          </div>
        ),
        width: 100,
      }
    }

    if (phase === 'replying') {
      return {
        leading: <Loader2 size={14} className="notif-status-icon notif-status-sending spin" />,
        trailing: <span className="notif-status-text notif-status-sending">Sending</span>,
        width: 110,
      }
    }

    if (phase === 'sent') {
      return {
        leading: <CheckCircle2 size={14} className="notif-status-icon notif-status-sent" />,
        trailing: <span className="notif-status-text notif-status-sent">Sent</span>,
        width: 90,
      }
    }

    return {
      leading: (
        <div className="notif-compact-leading">
          <div className="notif-bubble-icon">
            <MessageSquare size={12} className="notif-bubble-glyph" />
          </div>
        </div>
      ),
      trailing: (
        <div className="notif-compact-trailing">
          <img
            src="https://picsum.photos/seed/sarah/100/100"
            alt="Avatar"
            className="notif-avatar notif-avatar-sm"
            referrerPolicy="no-referrer"
          />
        </div>
      ),
      width: 110,
    }
  }

  let expandedHeight = 130
  if (phase === 'composing') expandedHeight = 140
  if (phase === 'typing' || phase === 'replying' || phase === 'sent') expandedHeight = 90

  return (
    <StandardIsland
      expanded={expanded}
      onToggle={() => setExpanded(prev => !prev)}
      config={{
        compact: getCompactContent(),
        expanded: {
          width: 366,
          height: expandedHeight,
          leading: (
            <div className="notif-avatar-wrap">
              <img
                src="https://picsum.photos/seed/sarah/100/100"
                alt="Avatar"
                className="notif-avatar notif-avatar-lg"
                referrerPolicy="no-referrer"
              />
              <div className="notif-avatar-badge">
                <MessageSquare size={10} className="notif-avatar-badge-icon" />
              </div>
            </div>
          ),
          center: (
            <div className="notif-center">
              <div className="notif-title-row">
                <span className="notif-title">Sarah Jenkins</span>
                <span className="notif-time">now</span>
              </div>

              {phase === 'typing' ? (
                <div className="notif-typing-row notif-typing-row-inline">
                  <motion.span
                    className="notif-dot"
                    animate={{ y: [0, -3, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8, delay: 0 }}
                  />
                  <motion.span
                    className="notif-dot"
                    animate={{ y: [0, -3, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }}
                  />
                  <motion.span
                    className="notif-dot"
                    animate={{ y: [0, -3, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }}
                  />
                </div>
              ) : phase === 'replying' ? (
                <span className="notif-phase-line notif-status-sending">
                  <Loader2 size={14} className="spin" /> Sending reply...
                </span>
              ) : phase === 'sent' ? (
                <span className="notif-phase-line notif-status-sent">
                  <CheckCircle2 size={14} /> Reply sent
                </span>
              ) : (
                <span className="notif-message">{messages[messageIndex]}</span>
              )}
            </div>
          ),
          trailing: <div />,
          bottom: (
            <AnimatePresence mode="wait">
              {phase === 'unread' ? (
                <motion.div
                  key="actions"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="notif-actions"
                >
                  <button className="notif-btn notif-btn-ghost" onClick={handleDismiss}>
                    <X size={14} className="notif-btn-icon-faded" /> Dismiss
                  </button>
                  <button className="notif-btn notif-btn-primary" onClick={handleReplyClick}>
                    <Reply size={14} /> Reply
                  </button>
                </motion.div>
              ) : phase === 'composing' ? (
                <motion.div
                  key="input"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="notif-compose"
                >
                  <input
                    autoFocus
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend(e)}
                    placeholder="iMessage"
                    className="notif-input"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!replyText.trim()}
                    className={`notif-send ${replyText.trim() ? 'notif-send-active' : 'notif-send-disabled'}`}
                  >
                    <ArrowUp size={16} />
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          ),
        },
      }}
    />
  )
}
