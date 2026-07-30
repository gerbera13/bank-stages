import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import ZoomControls from '../Controls/ZoomControls.jsx'
import FloorPlanSvg from './FloorPlanSvg.jsx'

/**
 * Контейнер плана: зум/пан (react-zoom-pan-pinch) + SVG плана + кнопки управления.
 * Параметры — по specs/zoom-pan.md. Состояние выбора/фильтров пробрасывается сверху.
 *
 * @param {{
 *   floor: object,
 *   selectedObjectId?: string | null,
 *   onSelectObject?: (id: string) => void,
 *   visibleTypes?: Set<string>,
 * }} props
 */
export default function PlanCanvas({
  floor,
  selectedObjectId = null,
  onSelectObject,
  visibleTypes,
}) {
  return (
    <TransformWrapper
      minScale={0.6}
      maxScale={4}
      initialScale={1}
      centerOnInit
      limitToBounds
      wheel={{ step: 0.08 }}
      doubleClick={{ mode: 'zoomIn', step: 0.7, animation: { time: 0.3 } }}
      panning={{ velocityDisabled: false }}
      // Плавная анимация программного зума (кнопки)
      zoomAnimation={{ animationType: 'easeOut', duration: 280 }}
    >
      <div className="plan-canvas">
        <TransformComponent
          wrapperClass="plan-zoom-wrapper"
          contentClass="plan-zoom-content"
        >
          <FloorPlanSvg
            floor={floor}
            selectedObjectId={selectedObjectId}
            onSelectObject={onSelectObject}
            visibleTypes={visibleTypes}
          />
        </TransformComponent>
        <ZoomControls />
      </div>
    </TransformWrapper>
  )
}
