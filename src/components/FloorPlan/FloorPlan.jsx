import { observer } from 'mobx-react-lite'
import { useStore } from '../../state/storeContext.js'
import PlanCanvas from './PlanCanvas.jsx'

/**
 * Публичный компонент плана этажа.
 * Observer: читает активный этаж, выбор и фильтры из MobX-стора.
 *
 * @param {{ floor?: object }} props.floor — опционально; по умолчанию ui.activeFloor
 */
const FloorPlan = observer(function FloorPlan({ floor }) {
  const { ui, selection } = useStore()
  const activeFloor = floor ?? ui.activeFloor
  if (!activeFloor) return null

  return (
    <PlanCanvas
      floor={activeFloor}
      selectedObjectId={selection.selectedObjectId}
      onSelectObject={(id) => selection.select(id)}
      visibleTypes={ui.visibleTypes}
    />
  )
})

export default FloorPlan
