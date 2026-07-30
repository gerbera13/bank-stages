import { createContext, useContext } from 'react'

/** React Context для прокидывания RootStore. */
export const StoreContext = createContext(null)

/**
 * Возвращает RootStore. Использовать внутри observer-компонентов.
 * @returns {import('./RootStore.js').RootStore}
 */
export function useStore() {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error('useStore must be used within <StoreContext.Provider>')
  }
  return store
}
