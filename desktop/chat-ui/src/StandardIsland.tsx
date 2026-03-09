import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export interface StandardIslandConfig {
  compact: {
    width: number
    height?: number
    leading?: ReactNode
    trailing?: ReactNode
  }
  expanded: {
    width: number
    height: number
    leading?: ReactNode
    center?: ReactNode
    trailing?: ReactNode
    bottom?: ReactNode
  }
}

interface StandardIslandProps {
  expanded: boolean
  onToggle: () => void
  config: StandardIslandConfig
}

const ISLAND_SPRING = {
  type: 'spring' as const,
  stiffness: 360,
  damping: 32,
  mass: 0.92,
}

export function StandardIsland({ expanded, onToggle, config }: StandardIslandProps) {
  const compactHeight = config.compact.height ?? 36
  const compactRadius = Math.max(18, Math.round(compactHeight / 2))
  const expandedRadius = Math.max(30, Math.round(config.expanded.height / 4.2))

  return (
    <div className="std-island-stage">
      <motion.div
        className="std-island-shell"
        animate={{
          width: expanded ? config.expanded.width : config.compact.width,
          height: expanded ? config.expanded.height : compactHeight,
          borderRadius: expanded ? expandedRadius : compactRadius,
        }}
        transition={ISLAND_SPRING}
        onClick={onToggle}
      >
        <AnimatePresence mode="wait" initial={false}>
          {expanded ? (
            <motion.div
              key="expanded"
              className="std-island-expanded"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.2 }}
            >
              <div className="std-expanded-top">
                <div className="std-slot-leading">{config.expanded.leading}</div>
                <div className="std-slot-center">{config.expanded.center}</div>
                <div className="std-slot-trailing">{config.expanded.trailing}</div>
              </div>
              {config.expanded.bottom ? (
                <div className="std-expanded-bottom">{config.expanded.bottom}</div>
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key="compact"
              className="std-island-compact"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.16 }}
            >
              <div className="std-slot-leading">{config.compact.leading}</div>
              <div className="std-slot-trailing">{config.compact.trailing}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
