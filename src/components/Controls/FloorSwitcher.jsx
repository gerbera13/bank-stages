import { observer } from 'mobx-react-lite'
import { useStore } from '../../state/storeContext.js'
import styles from './Controls.module.css'

/**
 * Переключатель этажей. Клик → ui.setActiveFloor(id) (сбрасывает выбор).
 * См. specs/sidebar.md.
 */
const FloorSwitcher = observer(function FloorSwitcher() {
  const { ui } = useStore()

  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>Этаж</h3>
      <div className={styles.floorList}>
        {ui.floors.map((floor) => {
          const isActive = floor.id === ui.activeFloorId
          return (
            <button
              key={floor.id}
              type="button"
              className={`${styles.floorItem} ${
                isActive ? styles.floorItemActive : ''
              }`}
              onClick={() => ui.setActiveFloor(floor.id)}
              aria-current={isActive ? 'true' : undefined}
            >
              <span className={styles.floorLevel}>{floor.level}</span>
              <span className={styles.floorName}>{floor.name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
})

export default FloorSwitcher
