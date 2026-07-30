import { useState } from 'react'
import { cameraConePoints, polygonToPoints } from '../../utils/geometry.js'
import { OBJECT_ICONS, OBJECT_COLORS } from './objectTypes.js'
import styles from './FloorPlan.module.css'

/** Радиус конуса обзора камеры (в единицах SVG) */
const CONE_RADIUS = 130
/** Радиус маркера объекта */
const MARKER_R = 16

/**
 * Особый объект на плане: лифт / камера (с конусом обзора) / банкомат.
 * Состояния rest → hover → selected. См. specs/objects.md.
 *
 * ВАЖНО: позиционирование через SVG-атрибут transform="translate(x,y)" на внешней группе.
 * Hover-scale применяется к ВНУТРЕННЕЙ группе маркера (без translate), чтобы CSS-transform
 * не конфликтовал с SVG-атрибутом transform (иначе объект «прыгает» в 0,0 при наведении).
 *
 * @param {{
 *   obj: object,
 *   selected?: boolean,
 *   visible?: boolean,
 *   onSelect?: (id: string) => void,
 * }} props
 */
export default function PlanObject({
  obj,
  selected = false,
  visible = true,
  onSelect,
}) {
  const [hovered, setHovered] = useState(false)
  const Icon = OBJECT_ICONS[obj.type] ?? OBJECT_ICONS.atm
  const color = OBJECT_COLORS[obj.type]
  const active = selected || hovered

  // Скрыт фильтром типа — не рендерим
  if (!visible) return null

  const handleClick = () => onSelect?.(obj.id)

  return (
    <g
      transform={`translate(${obj.x}, ${obj.y})`}
      data-object-id={obj.id}
      className={styles.object}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      aria-label={obj.name}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
    >
      {/* Конус обзора — только для камеры. pointer-events: none, чтобы не перехватывал клики */}
      {obj.type === 'camera' && obj.details?.angle != null && (
        <polygon
          className={styles.cameraCone}
          points={polygonToPoints(
            cameraConePoints(
              0,
              0,
              CONE_RADIUS,
              obj.details.angle,
              obj.details.direction ?? 0
            )
          )}
          fill="url(#grad-camera-cone)"
          stroke={color}
          strokeOpacity="0.28"
          strokeWidth="1.2"
          pointerEvents="none"
        />
      )}

      {/* Кольцо выбора: пульсирующее (анимация) + статичная обводка для чёткой видимости */}
      {selected && (
        <>
          <circle
            className={styles.selectedRing}
            r={MARKER_R + 4}
            fill="none"
            stroke={color}
            strokeWidth="3"
          />
          <circle
            className={styles.selectedHalo}
            r={MARKER_R + 5}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeOpacity="0.55"
          />
        </>
      )}

      {/* Невидимый круг для удобного клика (больше видимой иконки).
          pointerEvents="all" — ловит клики даже с transparent fill. */}
      <circle r={MARKER_R + 6} fill="transparent" pointerEvents="all" />

      {/* Маркер-капсула с иконкой. Hover-scale применяется ЗДЕСЬ (внутренняя группа без translate),
          чтобы не конфликтовать с SVG-атрибутом transform внешней группы. */}
      <g
        className={`${styles.markerGroup} ${active ? styles.markerGroupActive : ''}`}
        filter={active ? 'url(#filter-object-glow)' : undefined}
      >
        <circle
          className={styles.marker}
          r={MARKER_R}
          fill={color}
          stroke="#ffffff"
          strokeWidth="2.5"
        />
        {/* Белая иконка */}
        <g
          transform="translate(-12, -12)"
          fill="none"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Icon />
        </g>
      </g>
    </g>
  )
}
