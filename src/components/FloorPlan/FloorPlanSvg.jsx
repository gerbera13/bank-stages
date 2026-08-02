import { observer } from 'mobx-react-lite'
import { polygonToPoints, polygonBoundingBox } from '../../utils/geometry.js'
import Defs from './Defs.jsx'
import Room from './Room.jsx'
import PlanObject from './PlanObject.jsx'

/**
 * Слоистый SVG-рендер плана этажа (КИЛЛЕР-ФИЧА).
 * Порядок слоёв строго по specs/floor-plan-render.md §1.
 *
 * Observer: подписывается на visibleTypes.has(...) для реактивности фильтров.
 *
 * @param {{
 *   floor: object,
 *   selectedObjectId?: string | null,
 *   onSelectObject?: (id: string) => void,
 *   visibleTypes?: Set<string>,
 * }} props
 */
const FloorPlanSvg = observer(function FloorPlanSvg({
  floor,
  selectedObjectId = null,
  onSelectObject,
  visibleTypes,
}) {
  if (!floor) return null

  const [w, h] = floor.bounds ?? [1000, 640]
  // Внутренний отступ от границ viewBox — для «воздуха» и тени контура
  const pad = 40
  // Безопасный доступ к коллекциям (на случай неполных данных)
  const rooms = floor.rooms ?? []
  const objects = floor.objects ?? []

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className="floor-svg"
      role="img"
      aria-label={`План этажа: ${floor.name}`}
    >
      <Defs />

      {/* clipPath для каждой комнаты — чтобы конус камеры отсекался по стенам помещения */}
      <defs>
        {rooms.map((room) => (
          <clipPath key={`clip-${room.id}`} id={`clip-${room.id}`} clipPathUnits="userSpaceOnUse">
            <polygon points={polygonToPoints(room.polygon)} />
          </clipPath>
        ))}
      </defs>

      {/* Слой 1: фон + сетка (не интерактивен) */}
      <g id="layer-background" pointerEvents="none">
        <rect x="0" y="0" width={w} height={h} fill="url(#pattern-grid)" />
      </g>

      {/* Слой 2: пол этажа — белая заливка + мягкая тень (как на архитектурном референсе). */}
      <g id="layer-floor" pointerEvents="none">
        <rect
          x={pad}
          y={pad}
          width={w - pad * 2}
          height={h - pad * 2}
          rx="0"
          fill="#ffffff"
          filter="url(#filter-floor-shadow)"
        />
      </g>

      {/* Слой 3: комнаты (не интерактивны — клики проходят к объектам) */}
      <g id="layer-rooms" pointerEvents="none">
        {rooms.map((room) => (
          <Room key={room.id} room={room} />
        ))}
      </g>

      {/* Слой 3b: ЖИРНЫЙ внешний контур здания (несущие стены, в которых окна).
          Рисуется по периметру стен комнат (80..920 × 60..580), поверх комнат. */}
      <g id="layer-outer-walls" pointerEvents="none">
        <BuildingOutline rooms={rooms} outline={floor.outline} />
      </g>

      {/* Слой 3c: Окна — поверх внешнего контура, прорезают толстую стену
          (белый проём + тонкая линия стекла). Архитектурное обозначение. */}
      <g id="layer-windows" pointerEvents="none">
        {rooms.flatMap((room) =>
          (room.windows ?? []).map((win, i) => (
            <ArchWindow key={`${room.id}-win-${i}`} win={win} />
          ))
        )}
        {/* Двери на периметре (внешние входы) — прорезают толстую внешнюю стену. */}
        {rooms.flatMap((room) =>
          (room.doors ?? [])
            .filter((d) => isOuterDoor(d))
            .map((door, i) => (
              <OuterDoorCut key={`${room.id}-od-${i}`} door={door} />
            ))
        )}
      </g>

      {/* Слой 4: двери — условно, MVP (Roadmap) */}

      {/* Слой 6: особые объекты (поверх комнат/подписей) */}
      <g id="layer-objects">
        {objects.map((obj) => {
          // Полигон комнаты, в которой находится объект (для отсечения конуса камеры по стенам)
          const room = obj.roomId ? rooms.find((r) => r.id === obj.roomId) : null
          return (
            <PlanObject
              key={obj.id}
              obj={obj}
              selected={obj.id === selectedObjectId}
              onSelect={onSelectObject}
              visible={visibleTypes ? visibleTypes.has(obj.type) : true}
              roomPolygon={room?.polygon}
              clipId={room ? `clip-${room.id}` : undefined}
            />
          )
        })}
      </g>
    </svg>
  )
})

export default FloorPlanSvg

/**
 * Жирный внешний контур здания (несущие стены по периметру, в которых окна).
 * Вычисляет общий bounding box всех комнат и рисует толстую обводку по нему.
 * Рисуется поверх комнат (слой 3b), под окнами/дверями.
 */
function BuildingOutline({ rooms, outline }) {
  // Если задан явный контур этажа (сложная форма) — рисуем его.
  if (outline && outline.length >= 3) {
    return (
      <polygon
        points={polygonToPoints(outline)}
        fill="none"
        stroke="#1e293b"
        strokeWidth="8"
        strokeLinejoin="miter"
      />
    )
  }

  if (rooms.length === 0) return null

  // Иначе — прямоугольник по bounding box всех комнат
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const room of rooms) {
    const bb = polygonBoundingBox(room.polygon)
    if (bb.x < minX) minX = bb.x
    if (bb.y < minY) minY = bb.y
    if (bb.x + bb.width > maxX) maxX = bb.x + bb.width
    if (bb.y + bb.height > maxY) maxY = bb.y + bb.height
  }

  const points = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]

  return (
    <polygon
      points={polygonToPoints(points)}
      fill="none"
      stroke="#1e293b"
      strokeWidth="8"
      strokeLinejoin="miter"
    />
  )
}

/**
 * Окно в архитектурном стиле: прорезает толстую внешнюю стену (белый проём),
 * внутри — тонкая линия стекла. win.w — размер; win.side — ориентация.
 * Рисуется в слое layer-windows ПОСЛЕ внешнего контура, поэтому «вырезает» стену.
 */
function ArchWindow({ win }) {
  const { x, y, w, side } = win
  const half = w / 2
  const isVertical = side === 'left' || side === 'right'
  // Толщина «выреза» — чуть больше толщины внешней стены (8), чтобы полностью перекрыть
  const cut = 10
  // Белый прямоугольник-проём (перекрывает тёмную стену)
  const cutRect = isVertical
    ? { x: x - cut / 2, y: y - half, width: cut, height: w }
    : { x: x - half, y: y - cut / 2, width: w, height: cut }
  // Тонкая линия стекла по центру проёма
  const glass = isVertical
    ? { x1: x, y1: y - half + 1, x2: x, y2: y + half - 1 }
    : { x1: x - half + 1, y1: y, x2: x + half - 1, y2: y }
  return (
    <g pointerEvents="none">
      {/* Белый проём — «вырез» в стене */}
      <rect
        x={cutRect.x}
        y={cutRect.y}
        width={cutRect.width}
        height={cutRect.height}
        fill="#ffffff"
      />
      {/* Тонкая линия стекла */}
      <line
        x1={glass.x1}
        y1={glass.y1}
        x2={glass.x2}
        y2={glass.y2}
        stroke="#475569"
        strokeWidth="1.2"
      />
    </g>
  )
}

/**
 * Дверь считается «внешней» (на периметре здания), если её координаты
 * лежат на внешних стенах (y≈60 верх, y≈580 низ, x≈80 лево, x≈920 право).
 * Такие двери должны прорезать толстую внешнюю стену.
 */
function isOuterDoor(door) {
  const tol = 3
  if (door.side === 'top' && Math.abs(door.y - 60) <= tol) return true
  if (door.side === 'bottom' && Math.abs(door.y - 580) <= tol) return true
  if (door.side === 'left' && Math.abs(door.x - 80) <= tol) return true
  if (door.side === 'right' && Math.abs(door.x - 920) <= tol) return true
  return false
}

/**
 * Прорезает толстую внешнюю стену в месте входной двери (белый проём).
 * Рисуется в слое layer-windows после внешнего контура.
 */
function OuterDoorCut({ door }) {
  const { x, y, w, side } = door
  const half = w / 2
  const isVertical = side === 'left' || side === 'right'
  const cut = 10 // перекрывает толщину внешней стены (8)
  const cutRect = isVertical
    ? { x: x - cut / 2, y: y - half, width: cut, height: w }
    : { x: x - half, y: y - cut / 2, width: w, height: cut }
  return (
    <rect
      x={cutRect.x}
      y={cutRect.y}
      width={cutRect.width}
      height={cutRect.height}
      fill="#ffffff"
      pointerEvents="none"
    />
  )
}
