import { observer } from 'mobx-react-lite'
import { useStore } from '../../state/storeContext.js'
import { OBJECT_TYPES } from '../objectTypesMeta.js'
import styles from './Controls.module.css'

/**
 * Фильтр по типам объектов. Чекбоксы → ui.toggleType.
 * См. specs/sidebar.md.
 */
const TypeFilter = observer(function TypeFilter() {
  const { ui } = useStore()

  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>Объекты</h3>
      <div className={styles.filterList}>
        {OBJECT_TYPES.map((t) => {
          const checked = ui.isTypeVisible(t.value)
          return (
            <label
              key={t.value}
              className={`${styles.filterRow} ${
                checked ? styles.filterRowChecked : ''
              }`}
            >
              <input
                type="checkbox"
                className={styles.filterCheckbox}
                checked={checked}
                onChange={() => ui.toggleType(t.value)}
              />
              <span
                className={styles.swatch}
                style={{ background: `var(${t.colorVar})` }}
                aria-hidden="true"
              />
              <span className={styles.filterLabel}>{t.label}</span>
            </label>
          )
        })}
      </div>
    </section>
  )
})

export default TypeFilter
