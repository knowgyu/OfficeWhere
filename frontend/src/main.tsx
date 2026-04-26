import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { SnackbarProvider } from './ui'
import { LibraryRescanProvider } from './contexts/LibraryRescanContext.tsx'
import { DisplaySettingsProvider } from './contexts/DisplaySettingsContext.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SnackbarProvider>
      <LibraryRescanProvider>
        <DisplaySettingsProvider>
          <App />
        </DisplaySettingsProvider>
      </LibraryRescanProvider>
    </SnackbarProvider>
  </React.StrictMode>,
)
