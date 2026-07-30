import { OBJECT_TYPES } from './objectTypesMeta.js'
import styles from './Controls/Controls.module.css'

/** Типы комнат для легенды (палитра из дизайн-системы) */
const ROOM_TYPES = [
  { label: 'Холл', colorVar: '--color-room-hall' },
  { label: 'Офис', colorVar: '--color-room-office' },
  { label: 'Переговорная', colorVar: '--color-room-meeting' },
  { label: 'Серверная', colorVar: '--color-room-server' },
  { label: 'Кафе', colorVar: '--color-room-cafe' },
  { label: 'Санузел', colorVar: '--color-room-service' },
  { label: 'Коридор', colorVar: '--color-room-corridor' },
]

/**
 * Легенда: расшифровка типов объектов и комнат.
 * Статичные данные (визуальная справка). См. specs/sidebar.md.
 */
export default function Legend() {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>Легенда</h3>

      <div className={styles.legendSubgroup}>
        <span className={styles.legendSubTitle}>Объекты</span>
        <ul className={styles.legendList}>
          {OBJECT_TYPES.map((t) => (
            <li key={t.value} className={styles.legendRow}>
              <span
                className={styles.swatch}
                style={{ background: `var(${t.colorVar})` }}
                aria-hidden="true"
              />
              <span>{t.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.legendSubgroup}>
        <span className={styles.legendSubTitle}>Помещения</span>
        <ul className={styles.legendList}>
          {ROOM_TYPES.map((t) => (
            <li key={t.label} className={styles.legendRow}>
              <span
                className={styles.swatch}
                style={{ background: `var(${t.colorVar})` }}
                aria-hidden="true"
              />
              <span>{t.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
