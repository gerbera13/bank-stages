import { observer } from 'mobx-react-lite'
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

      {/* Слой 1: фон + сетка (не интерактивен) */}
      <g id="layer-background" pointerEvents="none">
        <rect x="0" y="0" width={w} height={h} fill="url(#pattern-grid)" />
      </g>

      {/* Слой 2: контур/пол этажа (мягкая тень, скруглённые углы, воздушная заливка).
          Не интерактивен — клики проходят к объектам. */}
      <g id="layer-floor" pointerEvents="none">
        <rect
          x={pad}
          y={pad}
          width={w - pad * 2}
          height={h - pad * 2}
          rx="20"
          fill="url(#grad-floor)"
          filter="url(#filter-floor-shadow)"
        />
      </g>

      {/* Слой 3: комнаты (не интерактивны — клики проходят к объектам) */}
      <g id="layer-rooms" pointerEvents="none">
        {rooms.map((room) => (
          <Room key={room.id} room={room} />
        ))}
      </g>

      {/* Слой 4: двери — условно, MVP (Roadmap) */}

      {/* Слой 6: особые объекты (поверх комнат/подписей) */}
      <g id="layer-objects">
        {objects.map((obj) => (
          <PlanObject
            key={obj.id}
            obj={obj}
            selected={obj.id === selectedObjectId}
            onSelect={onSelectObject}
            visible={visibleTypes ? visibleTypes.has(obj.type) : true}
          />
        ))}
      </g>
    </svg>
  )
})

export default FloorPlanSvg
