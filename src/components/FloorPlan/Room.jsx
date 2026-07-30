import { polygonToPoints, polygonCentroid } from '../../utils/geometry.js'
import styles from './FloorPlan.module.css'

/**
 * Рендер комнаты: полигон с градиентной заливкой, обводка стен, дверь (проём + дуга),
 * окна (двойная линия на внешней стене) и подпись на плашке.
 * См. specs/floor-plan-render.md.
 *
 * @param {{
 *   room: {
 *     id: string, name: string, type: string,
 *     polygon: [number,number][], labelAnchor?: [number,number],
 *     doors?: { x: number, y: number, w: number, side: 'top'|'bottom'|'left'|'right' }[],
 *     windows?: { x: number, y: number, w: number }[],
 *   }
 * }} props
 */
export default function Room({ room }) {
  const points = polygonToPoints(room.polygon)
  const center = room.labelAnchor
    ? { x: room.labelAnchor[0], y: room.labelAnchor[1] }
    : polygonCentroid(room.polygon)

  const labelWidth = Math.min(220, Math.max(70, room.name.length * 9 + 20))

  return (
    <g className={styles.room}>
      {/* Заливка + стены. pointer-events: none задан на слое layer-rooms. */}
      <polygon
        className={styles.roomShape}
        points={points}
        fill={`url(#grad-room-${room.type})`}
        stroke="var(--color-wall)"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Двери: белая полоса-«проём» поверх стены + дуга открывания */}
      {(room.doors ?? []).map((door, i) => (
        <Door key={`door-${i}`} door={door} />
      ))}

      {/* Окна: двойная линия (синяя) поверх внешней стены */}
      {(room.windows ?? []).map((win, i) => (
        <Window key={`win-${i}`} win={win} />
      ))}

      {/* Подпись */}
      <g className={styles.roomLabel} transform={`translate(${center.x}, ${center.y})`}>
        <rect
          x={-labelWidth / 2}
          y={-12}
          width={labelWidth}
          height={24}
          rx="7"
          fill="#ffffff"
          fillOpacity="0.85"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <text
          className={styles.roomLabelText}
          textAnchor="middle"
          dominantBaseline="middle"
          y="1"
        >
          {room.name}
        </text>
      </g>
    </g>
  )
}

/**
 * Дверь: закрашивает участок стены цветом фона комнаты (создаёт «проём»),
 * плюс рисует дугу открывания — классическое архитектурное обозначение.
 * door.side определяет ориентацию: 'top'/'bottom' — горизонтальная стена, 'left'/'right' — вертикальная.
 */
function Door({ door }) {
  const { x, y, w, side } = door
  const isHorizontal = side === 'top' || side === 'bottom'
  const half = w / 2

  // Проём: белая полоса поверх стены (визуально «разрезает» стену)
  const gap = isHorizontal ? (
    <line
      x1={x - half}
      y1={y}
      x2={x + half}
      y2={y}
      stroke="#ffffff"
      strokeWidth="5"
      strokeLinecap="square"
    />
  ) : (
    <line
      x1={x}
      y1={y - half}
      x2={x}
      y2={y + half}
      stroke="#ffffff"
      strokeWidth="5"
      strokeLinecap="square"
    />
  )

  // Дуга открывания: четверть круга радиуса w от дверной петли.
  // Петля — один конец проёма; дуга уходит внутрь комнаты.
  const arc = makeDoorArc(door)

  return (
    <g pointerEvents="none">
      {gap}
      {arc}
    </g>
  )
}

/**
 * Строит дугу открывания двери (четверть круга).
 */
function makeDoorArc(door) {
  const { x, y, w, side } = door
  const half = w / 2
  // Стрелка-створка (линия от петли до открытого положения) + дуга.
  // Простой вариант: линия-створка + дуга 90°.
  let hinge, tipEnd, arcPath
  if (side === 'bottom') {
    // Петля слева, створка открывается вверх-вправо (в комнату, которая сверху)
    hinge = [x - half, y]
    tipEnd = [x - half, y - w]
    arcPath = `M ${x - half} ${y - w} A ${w} ${w} 0 0 1 ${x + half} ${y}`
  } else if (side === 'top') {
    // Комната снизу, открывается вниз
    hinge = [x - half, y]
    tipEnd = [x - half, y + w]
    arcPath = `M ${x - half} ${y + w} A ${w} ${w} 0 0 0 ${x + half} ${y}`
  } else if (side === 'left') {
    hinge = [x, y - half]
    tipEnd = [x + w, y - half]
    arcPath = `M ${x + w} ${y - half} A ${w} ${w} 0 0 1 ${x} ${y + half}`
  } else {
    // right
    hinge = [x, y - half]
    tipEnd = [x - w, y - half]
    arcPath = `M ${x - w} ${y - half} A ${w} ${w} 0 0 0 ${x} ${y + half}`
  }
  return (
    <g
      stroke="var(--color-wall-inner)"
      strokeWidth="1.2"
      fill="none"
      strokeOpacity="0.7"
      strokeLinecap="round"
    >
      {/* Створка */}
      <line x1={hinge[0]} y1={hinge[1]} x2={tipEnd[0]} y2={tipEnd[1]} />
      {/* Дуга */}
      <path d={arcPath} />
    </g>
  )
}

/**
 * Окно: двойная линия поверх внешней стены (классическое обозначение окна).
 * win.w — ширина; ориентация определяется по координатам (горизонтальные окна на top/bottom).
 */
function Window({ win }) {
  const { x, y, w } = win
  const half = w / 2
  return (
    <g pointerEvents="none">
      {/* Внешняя тонкая линия окна (верхняя) */}
      <line
        x1={x - half}
        y1={y}
        x2={x + half}
        y2={y}
        stroke="#7dd3fc"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Внутренняя линия (двойная) — имитация стеклопакета */}
      <line
        x1={x - half}
        y1={y}
        x2={x + half}
        y2={y}
        stroke="#ffffff"
        strokeWidth="0.8"
      />
    </g>
  )
}
