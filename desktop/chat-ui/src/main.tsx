// @input: React root element, App component, global styles
// @output: Mounted React application
// @position: Entry point — bootstraps the React SPA

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
