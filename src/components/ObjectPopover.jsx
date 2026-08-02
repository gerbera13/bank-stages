import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import {
  useFloating,
  offset,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
} from '@floating-ui/react'
import { X } from 'lucide-react'
import { useStore } from '../state/storeContext.js'
import {
  OBJECT_ICONS,
  OBJECT_COLORS,
} from './FloorPlan/objectTypes.js'
import { getObjectDetails } from './objectDetails.js'
import { STATUS_META } from './statusMeta.js'
import styles from './ObjectPopover.module.css'

/**
 * Поповер с деталями выбранного объекта. Позиционируется через @floating-ui/react.
 * Якорь — DOM-элемент выбранного объекта (по data-object-id). См. specs/popover.md.
 *
 * ПОЗИЦИОНИРОВАНИЕ СТАБИЛЬНОЕ (без дёрганья):
 * - placement фиксирован ('right'); без flip/shift — не «перепрыгивает» между сторонами.
 * - autoUpdate отключён — позиция рассчитывается ОДИН раз при открытии и не пересчитывается
 *   при движении мыши/зуме. Поповер «стоит на месте».
 */
const ObjectPopover = observer(function ObjectPopover() {
  const { selection } = useStore()
  const obj = selection.selectedObject
  const open = !!obj

  // Элемент-якорь: ищем по data-object-id при каждом открытии.
  // Зависимость только от id (не всего obj) — повторный поиск нужен лишь при смене объекта.
  const [anchorEl, setAnchorEl] = useState(null)
  useEffect(() => {
    if (!obj) {
      setAnchorEl(null)
      return
    }
    const el = document.querySelector(`[data-object-id="${obj.id}"]`)
    setAnchorEl(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj?.id, open])

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      if (!next) selection.clear()
    },
    placement: 'right',
    // Только фиксированный отступ; без flip/shift/autoUpdate — позиция стабильна.
    middleware: [offset(16)],
    elements: { reference: anchorEl },
  })

  // Закрытие по Escape и клику вне; роль dialog
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: true })
  const role = useRole(context, { role: 'dialog' })
  const { getFloatingProps } = useInteractions([dismiss, role])

  if (!open || !obj) return null

  const Icon = OBJECT_ICONS[obj.type] ?? OBJECT_ICONS.atm
  const color = OBJECT_COLORS[obj.type]
  const status = STATUS_META[obj.status]
  const { rows, cashPercent } = getObjectDetails(obj)

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={styles.popover}
        {...getFloatingProps()}
        aria-label={obj.name}
      >
        {/* Шапка */}
        <header className={styles.header}>
          <span className={styles.iconWrap} style={{ background: color }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <Icon />
            </svg>
          </span>
          <div className={styles.titleBlock}>
            <h3 className={styles.title}>{obj.name}</h3>
            {status && (
              <span
                className={styles.statusBadge}
                style={{ color: status.color, background: status.soft }}
              >
                <span
                  className={styles.statusDot}
                  style={{ background: status.color }}
                />
                {status.label}
              </span>
            )}
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Закрыть"
            onClick={() => selection.clear()}
          >
            <X size={16} />
          </button>
        </header>

        {/* Тело */}
        <div className={styles.body}>
          {cashPercent != null && (
            <div className={styles.cashRow}>
              <div className={styles.cashLabel}>
                <span>Уровень наличности</span>
                <span className={styles.cashValue}>{cashPercent}%</span>
              </div>
              <div className={styles.cashTrack}>
                <div
                  className={styles.cashFill}
                  style={{ width: `${cashPercent}%` }}
                />
              </div>
            </div>
          )}

          <dl className={styles.details}>
            {rows.map((row) => (
              <div className={styles.detailRow} key={row.label}>
                <dt className={styles.detailLabel}>{row.label}</dt>
                <dd className={styles.detailValue}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </FloatingPortal>
  )
})

export default ObjectPopover
