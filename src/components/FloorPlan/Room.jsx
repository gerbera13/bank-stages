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

  const fontSize = room.labelFontSize ?? 14
  const labelWidth = Math.min(220, Math.max(70, room.name.length * (fontSize / 14) * 9 + 20))

  return (
    <g className={styles.room}>
      {/* Заливка комнаты — плоская однотонная + мягкая тень для объёма. */}
      <polygon
        points={points}
        fill={`var(--color-room-${room.type})`}
        filter="url(#filter-room-shadow)"
      />
      {/* Внутренние перегородки — заметные, тёмно-серые (ярче для читаемости). */}
      <polygon
        className={styles.roomShape}
        points={points}
        fill="none"
        stroke="#475569"
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />

      {/* Вырезы в стене (wallGaps): «стёртые» участки обводки — открытые проходы.
          Каждый gap = { x1, y1, x2, y2 } — сегмент стены, который не рисуется.
          Перекрываем его прямоугольником цвета заливки комнаты. */}
      {(room.wallGaps ?? []).map((gap, i) => (
        <WallGap key={`gap-${i}`} gap={gap} fill={`var(--color-room-${room.type})`} />
      ))}

      {/* Двери: белая полоса-«проём» поверх стены + дуга открывания */}
      {(room.doors ?? []).map((door, i) => (
        <Door key={`door-${i}`} door={door} />
      ))}

      {/* Элементы интерьера (features): перила, стойки, столики.
          Каждый = { type, ... }. Рисуются с тенью для объёма. */}
      {(room.features ?? []).map((feat, i) => (
        <RoomFeature key={`feat-${i}`} feat={feat} />
      ))}

      {/* Окна рендерятся в отдельном слое layer-windows (после внешнего контура),
          чтобы прорезать толстую внешнюю стену. */}

      {/* Подпись — только если имя не пустое (Тамбур/Санузел/Лифтовой холл без подписи) */}
      {room.name && (
        <g className={styles.roomLabel} transform={`translate(${center.x}, ${center.y})`}>
          {room.name.length <= 2 ? (
            // Короткая подпись (М/Ж) — без плашки, средним жирным шрифтом
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="18"
              fontWeight="700"
              fill="var(--color-text)"
            >
              {room.name}
            </text>
          ) : (
            // Длинная подпись — на плашке
            <>
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
                style={room.labelFontSize ? { fontSize: room.labelFontSize } : undefined}
              >
                {room.name}
              </text>
            </>
          )}
        </g>
      )}
    </g>
  )
}

/**
 * Дверь: закрашивает участок стены цветом фона комнаты (создаёт «проём»),
 * плюс рисует дугу открывания — классическое архитектурное обозначение.
 * door.side определяет ориентацию: 'top'/'bottom' — горизонтальная стена, 'left'/'right' — вертикальная.
 */
function Door({ door }) {
  const { x, y, w, side, doubleDoor } = door

  // Двойная распашная дверь: две створки в РАЗНЫЕ стороны от центра.
  // Левая створка — открывается вправо, правая — влево (обратное направление).
  if (doubleDoor) {
    const halfW = w / 2
    const center = x // центр проёма
    const leftDoor = { x: center - halfW / 2, y, w: halfW, side }
    const rightDoor = { x: center + halfW / 2, y, w: halfW, side }
    return (
      <g pointerEvents="none">
        {/* Проём во всю ширину двойной двери */}
        <rect x={x - w / 2 - 1} y={side === 'bottom' ? y - 3 : y} width={w + 2} height={3} fill="#ffffff" rx="0.5" />
        {/* Левая створка — вправо, правая — влево */}
        {makeDoorArc(leftDoor, false)}
        {makeDoorArc(rightDoor, true)}
      </g>
    )
  }

  const half = w / 2

  // Проём: белый прямоугольник внутрь комнаты от стены.
  let gap
  if (side === 'top') {
    gap = <rect x={x - half - 1} y={y} width={w + 2} height={3} fill="#ffffff" rx="0.5" />
  } else if (side === 'bottom') {
    gap = <rect x={x - half - 1} y={y - 3} width={w + 2} height={3} fill="#ffffff" rx="0.5" />
  } else if (side === 'left') {
    gap = <rect x={x} y={y - half - 1} width={3} height={w + 2} fill="#ffffff" rx="0.5" />
  } else {
    // right
    gap = <rect x={x - 3} y={y - half - 1} width={3} height={w + 2} fill="#ffffff" rx="0.5" />
  }

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
function makeDoorArc(door, mirror = false) {
  const { x, y, w, side } = door
  const half = w / 2
  // Стрелка-створка (линия от петли до открытого положения) + дуга.
  // mirror = true — створка открывается в противоположную сторону (для двойной двери).
  let hinge, tipEnd, arcPath
  if (side === 'bottom') {
    if (mirror) {
      // Петля справа, створка открывается вверх-влево
      hinge = [x + half, y]
      tipEnd = [x + half, y - w]
      arcPath = `M ${x + half} ${y - w} A ${w} ${w} 0 0 0 ${x - half} ${y}`
    } else {
      // Петля слева, створка открывается вверх-вправо (в комнату, которая сверху)
      hinge = [x - half, y]
      tipEnd = [x - half, y - w]
      arcPath = `M ${x - half} ${y - w} A ${w} ${w} 0 0 1 ${x + half} ${y}`
    }
  } else if (side === 'top') {
    if (mirror) {
      hinge = [x + half, y]
      tipEnd = [x + half, y + w]
      arcPath = `M ${x + half} ${y + w} A ${w} ${w} 0 0 1 ${x - half} ${y}`
    } else {
      hinge = [x - half, y]
      tipEnd = [x - half, y + w]
      arcPath = `M ${x - half} ${y + w} A ${w} ${w} 0 0 0 ${x + half} ${y}`
    }
  } else if (side === 'left') {
    if (mirror) {
      hinge = [x, y + half]
      tipEnd = [x + w, y + half]
      arcPath = `M ${x + w} ${y + half} A ${w} ${w} 0 0 0 ${x} ${y - half}`
    } else {
      hinge = [x, y - half]
      tipEnd = [x + w, y - half]
      arcPath = `M ${x + w} ${y - half} A ${w} ${w} 0 0 1 ${x} ${y + half}`
    }
  } else {
    // right
    if (mirror) {
      hinge = [x, y + half]
      tipEnd = [x - w, y + half]
      arcPath = `M ${x - w} ${y + half} A ${w} ${w} 0 0 1 ${x} ${y - half}`
    } else {
      hinge = [x, y - half]
      tipEnd = [x - w, y - half]
      arcPath = `M ${x - w} ${y - half} A ${w} ${w} 0 0 0 ${x} ${y + half}`
    }
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
 * Вырез в стене (wallGap): «стёртый» участок обводки комнаты — открытый проход.
 * Перекрывает сегмент стены прямоугольником цвета заливки комнаты.
 * gap = { x1, y1, x2, y2 } — координаты концов сегмента стены.
 */
function WallGap({ gap, fill }) {
  const { x1, y1, x2, y2 } = gap
  // Определим ориентацию: горизонтальная (y1≈y2) или вертикальная (x1≈x2)
  const isHorizontal = Math.abs(y1 - y2) < Math.abs(x1 - x2)
  const sw = 4 // ширина перекрытия (чуть больше толщины стены 1.5)
  if (isHorizontal) {
    const y = (y1 + y2) / 2
    return (
      <rect
        x={Math.min(x1, x2)}
        y={y - sw / 2}
        width={Math.abs(x2 - x1)}
        height={sw}
        fill={fill}
        pointerEvents="none"
      />
    )
  }
  const x = (x1 + x2) / 2
  return (
    <rect
      x={x - sw / 2}
      y={Math.min(y1, y2)}
      width={sw}
      height={Math.abs(y2 - y1)}
      fill={fill}
      pointerEvents="none"
    />
  )
}

/**
 * Элемент интерьера комнаты: перила балкона, барная стойка, столик.
 * Все рисуются с тенью (filter-room-shadow) для объёма.
 * feat.type: 'railing' | 'counter' | 'table'.
 */
function RoomFeature({ feat }) {
  if (feat.type === 'tilePatch') {
    // Плитка на полу — полигон (points). Если pattern задан — заливка паттерном
    // (диагональные полоски для объёма), иначе сплошная заливка.
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    const fillVal = feat.pattern ? `url(#${feat.pattern})` : (feat.color || '#e2e8f0')
    return (
      <g pointerEvents="none">
        <polygon points={pts} fill={fillVal} fillOpacity={feat.pattern ? '1' : '0.6'} stroke={feat.stroke || '#94a3b8'} strokeWidth="0.8" />
      </g>
    )
  }
  if (feat.type === 'tileArc') {
    // Полукруглая плитка на полу — путь (path) в форме полукруга.
    // cx, cy — центр; r — радиус; dir — направление ('up'/'down'/'left'/'right').
    const { cx, cy, r = 50, dir = 'up', color = '#e2e8f0' } = feat
    let pathD
    if (dir === 'up') {
      pathD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`
    } else if (dir === 'down') {
      pathD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy} Z`
    } else if (dir === 'left') {
      pathD = `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`
    } else {
      pathD = `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} Z`
    }
    return (
      <g pointerEvents="none">
        <path d={pathD} fill={color} fillOpacity="0.7" stroke="#94a3b8" strokeWidth="0.8" />
      </g>
    )
  }
  if (feat.type === 'tileCircle') {
    // Круглый фрагмент плитки (акцент) — круг на полу.
    const { cx, cy, r = 20, color = '#fbbf24' } = feat
    return (
      <g pointerEvents="none">
        <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity="0.85" stroke={feat.stroke || '#92400e'} strokeWidth="1" />
      </g>
    )
  }
  if (feat.type === 'counterCurve') {
    // Тонкая изогнутая стойка — полигон с изгибом (как на референсе).
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    return (
      <g pointerEvents="none">
        {/* Тень */}
        <polygon points={pts} fill="#0f172a" opacity="0.2" transform="translate(2, 3)" filter="url(#filter-room-shadow)" />
        {/* Стойка (цвет можно задать через feat.color, по умолчанию тёмная) */}
        <polygon points={pts} fill={feat.color || '#475569'} stroke="#1e293b" strokeWidth="1" strokeLinejoin="round" />
      </g>
    )
  }
  if (feat.type === 'partition') {
    // Внутренняя перегородка — разделяет кабинет. Прямая стена с проёмом (дверью).
    // points — точки перегородки (ломаная); doorGap — координаты проёма [x1,y1,x2,y2].
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    const gap = feat.doorGap
    return (
      <g pointerEvents="none">
        <polyline
          points={pts}
          fill="none"
          stroke="#475569"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#filter-room-shadow)"
        />
        {/* Проём в перегородке */}
        {gap && (
          <rect
            x={Math.min(gap[0], gap[2]) - 2}
            y={Math.min(gap[1], gap[3]) - 2}
            width={Math.abs(gap[2] - gap[0]) + 4}
            height={Math.abs(gap[3] - gap[1]) + 4}
            fill="#fef3c7"
          />
        )}
      </g>
    )
  }
  if (feat.type === 'railing') {
    // Перила балкона — ломаная линия по точкам points, с тенью.
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    return (
      <g pointerEvents="none" filter="url(#filter-room-shadow)">
        <polyline
          points={pts}
          fill="none"
          stroke="#334155"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )
  }
  if (feat.type === 'counter') {
    // Барная стойка — полигон (points), заливка + обводка + тень.
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    return (
      <g pointerEvents="none" filter="url(#filter-room-shadow)">
        <polygon points={pts} fill="#e2e8f0" stroke="#475569" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
    )
  }
  if (feat.type === 'counterBar') {
    // Высокая кассовая стойка — длинная узкая полоса, тёмная заливка + сильная тень
    // (объём, чтобы было понятно что она высокая). points — полигон-полоса.
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    return (
      <g pointerEvents="none">
        {/* Сильная тень для объёма «высокой стойки» */}
        <polygon points={pts} fill="#1e293b" opacity="0.25" transform="translate(0, 6)" filter="url(#filter-room-shadow)" />
        {/* Сама стойка */}
        <polygon points={pts} fill="#475569" stroke="#1e293b" strokeWidth="1" strokeLinejoin="round" />
        {/* Верхняя кромка (светлее — имитация столешницы) */}
        <polygon points={pts} fill="none" stroke="#94a3b8" strokeWidth="1" strokeLinejoin="round" transform="translate(0, -2)" />
      </g>
    )
  }
  if (feat.type === 'screen') {
    // Ширма/ресепшн — полигон с тенью, образующий закуток (полупрозрачная перегородка).
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    return (
      <g pointerEvents="none">
        {/* Тень от ширмы */}
        <polygon points={pts} fill="#0f172a" opacity="0.18" transform="translate(3, 4)" filter="url(#filter-room-shadow)" />
        {/* Сама ширма — светлый полупрозрачный материал */}
        <polygon points={pts} fill="#cbd5e1" fillOpacity="0.85" stroke="#475569" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
    )
  }
  if (feat.type === 'bench') {
    // Пуфик/скамейка — прямоугольник с мягкой обивкой (скруглённый) + тень.
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    return (
      <g pointerEvents="none">
        {/* Тень */}
        <polygon points={pts} fill="#0f172a" opacity="0.2" transform="translate(2, 4)" filter="url(#filter-room-shadow)" />
        {/* Сам пуфик — мягкая обивка */}
        <rect
          x={Math.min(...(feat.points ?? []).map((p) => p[0]))}
          y={Math.min(...(feat.points ?? []).map((p) => p[1]))}
          width={Math.abs(feat.points?.[1]?.[0] - feat.points?.[0]?.[0]) || 60}
          height={Math.abs(feat.points?.[2]?.[1] - feat.points?.[0]?.[1]) || 25}
          rx="6"
          fill="#c7d2fe"
          stroke="#6366f1"
          strokeWidth="1"
        />
      </g>
    )
  }
  if (feat.type === 'chair') {
    // Кресло — квадрат со скруглёнными углами + тень.
    const { x, y } = feat
    return (
      <g pointerEvents="none" filter="url(#filter-room-shadow)">
        <rect x={x - 8} y={y - 8} width="16" height="16" rx="4" fill="#e0e7ff" stroke="#6366f1" strokeWidth="1" />
      </g>
    )
  }
  if (feat.type === 'table') {
    // Столик — круг (x, y, r) + тень.
    const { x, y, r = 10 } = feat
    return (
      <g pointerEvents="none" filter="url(#filter-room-shadow)">
        <circle cx={x} cy={y} r={r} fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.2" />
      </g>
    )
  }
  return null
}
