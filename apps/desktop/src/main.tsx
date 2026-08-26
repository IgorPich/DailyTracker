import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './context/AppContext'
import { ToastProvider } from './context/ToastContext'
import './styles.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

if (import.meta.env.MODE === 'sqlite-smoke') {
  void import('./services/NativeSqliteWebViewSmoke').then(({ NativeSqliteWebViewSmoke }) => {
    root.render(<NativeSqliteWebViewSmoke />)
  })
} else {
  root.render(
    <React.StrictMode>
      <AppProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AppProvider>
    </React.StrictMode>,
  )
}
