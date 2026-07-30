import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StoreContext } from './state/storeContext.js'
import { RootStore } from './state/RootStore.js'
import App from './App.jsx'
import './index.css'

// Один экземпляр RootStore на всё приложение (синглтон через провайдер)
const rootStore = new RootStore()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StoreContext.Provider value={rootStore}>
      <App />
    </StoreContext.Provider>
  </StrictMode>
)
