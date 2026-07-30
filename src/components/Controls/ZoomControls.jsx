import { useControls } from 'react-zoom-pan-pinch'
import { Plus, Minus, Maximize2 } from 'lucide-react'
import styles from './Controls.module.css'

/**
 * Кнопки управления зумом: приблизить / отдалить / сброс.
 * Должен использоваться внутри <TransformWrapper> (использует useControls).
 * См. specs/zoom-pan.md.
 */
export default function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls()

  return (
    <div className={styles.zoomControls}>
      <button
        type="button"
        className={styles.zoomBtn}
        aria-label="Приблизить"
        title="Приблизить"
        onClick={() => zoomIn(0.3)}
      >
        <Plus size={18} strokeWidth={2.5} />
      </button>
      <button
        type="button"
        className={styles.zoomBtn}
        aria-label="Отдалить"
        title="Отдалить"
        onClick={() => zoomOut(0.3)}
      >
        <Minus size={18} strokeWidth={2.5} />
      </button>
      <div className={styles.zoomDivider} />
      <button
        type="button"
        className={styles.zoomBtn}
        aria-label="Сбросить масштаб"
        title="Сбросить масштаб"
        onClick={() => resetTransform()}
      >
        <Maximize2 size={16} strokeWidth={2.5} />
      </button>
    </div>
  )
}
