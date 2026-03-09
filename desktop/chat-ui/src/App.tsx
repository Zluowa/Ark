// @input: NotificationIsland (default) + ChatPanel legacy view
// @output: Root React component tree
// @position: App shell

import { ChatPanel } from './ChatPanel'
import { NotificationIsland } from './NotificationIsland'

function getViewMode(): 'notification' | 'chat' {
  const mode = new URLSearchParams(window.location.search).get('view')
  return mode === 'chat' ? 'chat' : 'notification'
}

export default function App() {
  const viewMode = getViewMode()
  return viewMode === 'chat' ? <ChatPanel /> : <NotificationIsland />
}
