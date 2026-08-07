import { polygonToPoints, polygonCentroid } from '../../utils/geometry.js'
import styles from './FloorPlan.module.css'

/**
 * Типы комнат, для которых в Defs.jsx объявлены пастельные градиенты
 * (grad-room-<type>). Неизвестный тип — fallback на office.
 */
const GRAD_ROOM = {
  hall: true,
  office: true,
  meeting: true,
  server: true,
  service: true,
  cafe: true,
  corridor: true,
}

/**
 * Рендер комнаты: полигон с градиентной заливкой, обводка стен, дверь (проём + дуга),
 * окна (двойная линия на внешней стене) и подпись на плашке.
 * См. specs/floor-plan-render.md.
 *
 * В режиме raw — «некрасивый» исходный чертёж: белая заливка, тонкая тёмная стена,
 * подпись без плашки.
 *
 * @param {{
 *   room: {
 *     id: string, name: string, type: string,
 *     polygon: [number,number][], labelAnchor?: [number,number],
 *     doors?: { x: number, y: number, w: number, side: 'top'|'bottom'|'left'|'right' }[],
 *     windows?: { x: number, y: number, w: number }[],
 *   },
 *   raw?: boolean,
 * }} props
 */
export default function Room({ room, raw = false }) {
  const points = polygonToPoints(room.polygon)
  const center = room.labelAnchor
    ? { x: room.labelAnchor[0], y: room.labelAnchor[1] }
    : polygonCentroid(room.polygon)

  const fontSize = room.labelFontSize ?? 14
  const labelWidth = Math.min(220, Math.max(70, room.name.length * (fontSize / 14) * 9 + 20))
  // Конвертер кладёт внутренние стены как partition — тогда обводку полигона не рисуем
  // (иначе «серая полоса» поверх толстой стены, make-stage.md §8.5 п.7).
  const hasPartitions = (room.features ?? []).some((f) => f.type === 'partition')

  return (
    <g className={styles.room}>
      {/* Заливка комнаты — пастельный градиент (сверху насыщеннее → снизу светлее,
          объём + направление света сверху) + мягкая тень. Применяется автоматически
          для любого этажа: градиент выбирается по room.type, fallback — office.
          В raw-режиме — белая, без тени (некрасивый стандартный чертёж). */}
      <polygon
        points={points}
        fill={raw ? '#ffffff' : `url(#grad-room-${Object.hasOwn(GRAD_ROOM, room.type) ? room.type : 'office'})`}
        filter={raw ? undefined : 'url(#filter-room-shadow)'}
      />
      {/* Внутренние стены. Если есть partition-features — обводку гасим
          (толстые стены уже рисует partition), иначе обычная обводка. */}
      <polygon
        className={styles.roomShape}
        points={points}
        fill="none"
        stroke={raw ? '#1e293b' : hasPartitions ? 'none' : '#475569'}
        strokeWidth={raw ? '2' : '1.5'}
        strokeLinejoin={raw ? 'miter' : 'round'}
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

      {/* Элементы интерьера. partition рисуется в FloorPlanSvg (слой поверх всех комнат),
          иначе соседняя заливка перекрывает стену на общем ребре. */}
      {(room.features ?? [])
        .filter((f) => f.type !== 'partition')
        .map((feat, i) => (
          <RoomFeature key={`feat-${i}`} feat={feat} />
        ))}

      {/* Окна рендерятся в отдельном слое layer-windows (после внешнего контура),
          чтобы прорезать толстую внешнюю стену. */}

      {/* Подпись — только если имя не пустое (Тамбур/Санузел/Лифтовой холл без подписи) */}
      {room.name && (
        <g className={styles.roomLabel} transform={`translate(${center.x}, ${center.y})`}>
          {raw || room.name.length <= 2 ? (
            // Raw-режим или короткая подпись (М/Ж) — без плашки, средним жирным шрифтом
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={raw ? '11' : '18'}
              fontWeight={raw ? '500' : '700'}
              fill={raw ? '#334155' : 'var(--color-text)'}
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
 * Дверь. style: 'cross' — крест-полоски организации (make-stage.md §8.2 / §8.5 п.9);
 * иначе — дуга открывания (классика).
 */
function Door({ door }) {
  const { x, y, w, side, doubleDoor, style } = door

  if (style === 'cross') {
    return <CrossDoor door={door} />
  }

  // Двойная распашная дверь: две створки в РАЗНЫЕ стороны от центра.
  if (doubleDoor) {
    const halfW = w / 2
    const center = x
    const leftDoor = { x: center - halfW / 2, y, w: halfW, side }
    const rightDoor = { x: center + halfW / 2, y, w: halfW, side }
    return (
      <g pointerEvents="none">
        <rect x={x - w / 2 - 1} y={side === 'bottom' ? y - 3 : y} width={w + 2} height={3} fill="#ffffff" rx="0.5" />
        {makeDoorArc(leftDoor, false)}
        {makeDoorArc(rightDoor, true)}
      </g>
    )
  }

  const half = w / 2
  let gap
  if (side === 'top') {
    gap = <rect x={x - half - 1} y={y} width={w + 2} height={3} fill="#ffffff" rx="0.5" />
  } else if (side === 'bottom') {
    gap = <rect x={x - half - 1} y={y - 3} width={w + 2} height={3} fill="#ffffff" rx="0.5" />
  } else if (side === 'left') {
    gap = <rect x={x} y={y - half - 1} width={3} height={w + 2} fill="#ffffff" rx="0.5" />
  } else {
    gap = <rect x={x - 3} y={y - half - 1} width={3} height={w + 2} fill="#ffffff" rx="0.5" />
  }

  return (
    <g pointerEvents="none">
      {gap}
      {makeDoorArc(door)}
    </g>
  )
}

/**
 * Дверь-крестик (стиль организации): полоска поперёк проёма + линия перпендикулярно стене.
 * §8.5 п.9: на H-стене планка 22×6 + линия 1.2×26; на V-стене планка 20×6 поперёк + линия 26.
 */
function CrossDoor({ door }) {
  const { x, y, side } = door
  const isH = side === 'top' || side === 'bottom'
  // Единые размеры (чуть крупнее для читаемости на конвертере)
  const plankW = isH ? 22 : 6
  const plankH = isH ? 6 : 20
  const lineLen = 26
  const lineT = 1.4

  // Светлый проём в толще стены
  const cut = isH ? (
    <rect x={x - 12} y={y - 5} width={24} height={10} fill="#f1f5f9" />
  ) : (
    <rect x={x - 5} y={y - 12} width={10} height={24} fill="#f1f5f9" />
  )

  // Планка поперёк проёма (#334155 / #cbd5e1)
  const plank = (
    <rect
      x={x - plankW / 2}
      y={y - plankH / 2}
      width={plankW}
      height={plankH}
      fill="#334155"
      rx="0.5"
    />
  )

  // Линия перпендикулярно стене (крест)
  const line = isH ? (
    <line
      x1={x}
      y1={y - lineLen / 2}
      x2={x}
      y2={y + lineLen / 2}
      stroke="#475569"
      strokeWidth={lineT}
      strokeLinecap="round"
    />
  ) : (
    <line
      x1={x - lineLen / 2}
      y1={y}
      x2={x + lineLen / 2}
      y2={y}
      stroke="#475569"
      strokeWidth={lineT}
      strokeLinecap="round"
    />
  )

  return (
    <g pointerEvents="none">
      {cut}
      {plank}
      {line}
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
    // Внутренняя стена — толстая тёмная (несущая/перегородка).
    const pts = (feat.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ')
    const gap = feat.doorGap
    const sw = feat.strokeWidth ?? 6
    return (
      <g pointerEvents="none">
        <polyline
          points={pts}
          fill="none"
          stroke="#1e293b"
          strokeWidth={sw}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        {gap && (
          <rect
            x={Math.min(gap[0], gap[2]) - 2}
            y={Math.min(gap[1], gap[3]) - 2}
            width={Math.abs(gap[2] - gap[0]) + 4}
            height={Math.abs(gap[3] - gap[1]) + 4}
            fill="#f1f5f9"
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
    // Кресло — скруглённый прямоугольник по реальным w/h.
    const { x, y, w = 16, h = 16 } = feat
    const rw = Math.max(10, w)
    const rh = Math.max(10, h)
    return (
      <g pointerEvents="none" filter="url(#filter-room-shadow)">
        <rect
          x={x - rw / 2}
          y={y - rh / 2}
          width={rw}
          height={rh}
          rx="4"
          fill="#e0e7ff"
          stroke="#6366f1"
          strokeWidth="1"
        />
      </g>
    )
  }
  if (feat.type === 'table') {
    // Столик — круг (x, y, r) + тень.
    const { x, y, r = 10, w, h } = feat
    const rr = r || Math.max(8, Math.round(Math.max(w ?? 16, h ?? 16) / 2))
    return (
      <g pointerEvents="none" filter="url(#filter-room-shadow)">
        <circle cx={x} cy={y} r={rr} fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.2" />
      </g>
    )
  }
  if (feat.type === 'toilet') {
    // Унитаз: чаша-овал + бачок у стены (tankDir), голубые §8.5 п.2.
    const { x, y, w = 14, h = 10, tankDir = 'right' } = feat
    const rx = w / 2
    const ry = h / 2
    const tankW = Math.max(5, Math.round(Math.min(w, h) * 0.45))
    const tankH = Math.max(6, Math.round(Math.max(w, h) * 0.55))
    let tank
    if (tankDir === 'left') {
      tank = { x: x - rx - tankW + 1, y: y - tankH / 2, w: tankW, h: tankH }
    } else if (tankDir === 'up') {
      tank = { x: x - tankH / 2, y: y - ry - tankW + 1, w: tankH, h: tankW }
    } else if (tankDir === 'down') {
      tank = { x: x - tankH / 2, y: y + ry - 1, w: tankH, h: tankW }
    } else {
      tank = { x: x + rx - 1, y: y - tankH / 2, w: tankW, h: tankH }
    }
    return (
      <g pointerEvents="none">
        <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#e0f2fe" stroke="#38bdf8" strokeWidth="1.2" />
        <rect
          x={tank.x}
          y={tank.y}
          width={tank.w}
          height={tank.h}
          rx="1.5"
          fill="#e0f2fe"
          stroke="#38bdf8"
          strokeWidth="1.2"
        />
      </g>
    )
  }
  if (feat.type === 'sink') {
    // Раковина: полукруг (плоская сторона к стене, выпуклость в комнату).
    const { x, y, w = 16, h = 9, dir = 'left' } = feat
    const r = w / 2
    let pathD
    if (dir === 'left') {
      pathD = `M ${x + r} ${y - h / 2} A ${r} ${h / 2} 0 0 0 ${x + r} ${y + h / 2} Z`
    } else if (dir === 'right') {
      pathD = `M ${x - r} ${y - h / 2} A ${r} ${h / 2} 0 0 1 ${x - r} ${y + h / 2} Z`
    } else if (dir === 'up') {
      pathD = `M ${x - w / 2} ${y + h / 2} A ${w / 2} ${h / 2} 0 0 1 ${x + w / 2} ${y + h / 2} Z`
    } else {
      pathD = `M ${x - w / 2} ${y - h / 2} A ${w / 2} ${h / 2} 0 0 0 ${x + w / 2} ${y - h / 2} Z`
    }
    return (
      <g pointerEvents="none">
        <path d={pathD} fill="#e0f2fe" stroke="#38bdf8" strokeWidth="1.2" />
      </g>
    )
  }
  if (feat.type === 'awning') {
    // Козырёк/навес над входом: полупрозрачный полигон + тень (приём §8.5).
    const { x, y, w = 60, h = 30 } = feat
    return (
      <g pointerEvents="none">
        <polygon
          points={`${x},${y + h} ${x},${y + h * 0.35} ${x + w},${y + h * 0.35} ${x + w},${y + h}`}
          fill="#94a3b8"
          fillOpacity="0.85"
          stroke="#475569"
          strokeWidth="1.2"
          strokeLinejoin="round"
          filter="url(#filter-room-shadow)"
        />
        {/* Кромка навеса */}
        <line x1={x} y1={y + h * 0.35} x2={x + w} y2={y + h * 0.35} stroke="#475569" strokeWidth="2" />
      </g>
    )
  }
  if (feat.type === 'stairs') {
    // Лестница: вертикальная направляющая + равные ступени (приём §8.5 п.8).
    const { x, y, step = 16, count = 8, len = 24, dir = 'right' } = feat
    const treads = []
    for (let i = 0; i < count; i++) {
      const ty = y + i * step
      const x0 = dir === 'right' ? x : x - len
      treads.push(<line key={i} x1={x0} y1={ty} x2={x0 + len} y2={ty} stroke="#94a3b8" strokeWidth="3" />)
    }
    return (
      <g pointerEvents="none">
        {/* Направляющая */}
        <line x1={x} y1={y - 4} x2={x} y2={y + count * step + 4} stroke="#475569" strokeWidth="2.5" />
        {treads}
      </g>
    )
  }
  return null
}
