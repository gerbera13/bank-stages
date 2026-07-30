import { Building2 } from 'lucide-react'
import { useStore } from './state/storeContext.js'
import FloorPlan from './components/FloorPlan/FloorPlan.jsx'
import ObjectPopover from './components/ObjectPopover.jsx'
import FloorSwitcher from './components/Controls/FloorSwitcher.jsx'
import TypeFilter from './components/Controls/TypeFilter.jsx'
import Legend from './components/Legend.jsx'
import styles from './App.module.css'

export default function App() {
  const { building } = useStore()

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <header className={styles.header}>
          <span className={styles.logo}>
            <Building2 size={20} />
          </span>
          <div>
            <h1 className={styles.title}>FloorPlan Studio</h1>
            <div className={styles.subtitle}>{building.name}</div>
          </div>
        </header>

        <FloorSwitcher />
        <TypeFilter />
        <Legend />
      </aside>

      <main className={styles.planArea}>
        <FloorPlan />
      </main>

      {/* Поповер рендерится в FloatingPortal (поверх всего) */}
      <ObjectPopover />
    </div>
  )
}
