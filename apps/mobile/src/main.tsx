import React from 'react'
import ReactDOM from 'react-dom/client'
import '@greekgod/design-tokens/tokens.css'
import './styles.css'
import { App } from './App'
import { MobileDataProvider } from './context/MobileDataContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileDataProvider>
      <App />
    </MobileDataProvider>
  </React.StrictMode>,
)
