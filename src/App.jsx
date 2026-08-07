import { useState } from 'react'
import { observer } from 'mobx-react-lite'
import { Building2, Wand2, FileImage } from 'lucide-react'
import { useStore } from './state/storeContext.js'
import FloorPlan from './components/FloorPlan/FloorPlan.jsx'
import ObjectPopover from './components/ObjectPopover.jsx'
import FloorSwitcher from './components/Controls/FloorSwitcher.jsx'
import TypeFilter from './components/Controls/TypeFilter.jsx'
import Legend from './components/Legend.jsx'
import ImportPanel from './components/Controls/ImportPanel.jsx'
import Converter from './components/Converter/Converter.jsx'
import styles from './App.module.css'

/** Режимы приложения: просмотр плана / конвертер чертежей (отдельное ПО). */
const App = observer(function App() {
  const { blueprint } = useStore()
  const building = blueprint.building
  // ?demo=1 — открыть сразу конвертер с загруженным демо-чертежом (для проверки)
  const [mode, setMode] = useState(() =>
    window.location.search.includes('demo=1') ? 'converter' : 'plan',
  )

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <header className={styles.header}>
          <span className={styles.logo}>
            <Building2 size={20} />
          </span>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>FloorPlan Studio</h1>
            <div className={styles.subtitle}>{building.name}</div>
          </div>
        </header>

        <nav className={styles.modeNav} aria-label="Режимы">
          <button
            type="button"
            className={`${styles.modeBtn} ${mode === 'plan' ? styles.modeBtnActive : ''}`}
            onClick={() => setMode('plan')}
          >
            <Building2 size={15} />
            План
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${mode === 'converter' ? styles.modeBtnActive : ''}`}
            onClick={() => setMode('converter')}
          >
            <Wand2 size={15} />
            Конвертер
          </button>
        </nav>

        {mode === 'plan' && (
          <>
            {/* Переключатель планов: демо-«Меридиан» ↔ актуальный чертёж */}
            <div className={styles.planSwitch} role="group" aria-label="Какой план показать">
              <span className={styles.planSwitchTitle}>План</span>
              <div className={styles.planSwitchRow}>
                <button
                  type="button"
                  className={`${styles.planSwitchBtn} ${!blueprint.showsDrawing ? styles.planSwitchBtnOn : ''}`}
                  onClick={() => blueprint.showsDrawing && blueprint.toggleDrawing()}
                  title="Демо-здание «Меридиан»"
                >
                  <Building2 size={14} />
                  Меридиан
                </button>
                <button
                  type="button"
                  className={`${styles.planSwitchBtn} ${blueprint.showsDrawing ? styles.planSwitchBtnOn : ''}`}
                  onClick={() => !blueprint.showsDrawing && blueprint.toggleDrawing()}
                  disabled={!blueprint.hasDrawing}
                  title={
                    blueprint.hasDrawing
                      ? `Показать ${blueprint.importedFrom}`
                      : 'Сконвертируйте чертёж во вкладке «Конвертер» или загрузите JSON'
                  }
                >
                  <FileImage size={14} />
                  Чертёж
                </button>
              </div>
            </div>
            <ImportPanel />
            <FloorSwitcher />
            <TypeFilter />
            <Legend />
          </>
        )}
      </aside>

      <main className={`${styles.planArea} ${blueprint.showsDrawing ? 'palette-draft' : ''}`}>
        {mode === 'plan' ? <FloorPlan /> : <Converter />}
      </main>

      {/* Поповер рендерится в FloatingPortal (поверх всего) */}
      <ObjectPopover />
    </div>
  )
})

export default App
