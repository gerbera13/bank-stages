import { useState } from 'react'
import { observer } from 'mobx-react-lite'
import { Upload, FileJson, Eraser, X } from 'lucide-react'
import { useStore } from '../../state/storeContext.js'
import styles from './ImportPanel.module.css'

/**
 * Панель импорта «сырого чертежа»: загрузка файла, вставка JSON или демо-пример.
 * Парсер (utils/blueprintParser.js) превращает прямоугольники в красивый план.
 *
 * Локальное состояние (open/drag) — useState (см. ADR-003: локальный UI-стат).
 */
const ImportPanel = observer(function ImportPanel() {
  const { blueprint } = useStore()
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [text, setText] = useState('')

  const handleFile = (file) => {
    if (!file) return
    blueprint.importFile(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer?.files?.[0]
    handleFile(file)
  }

  const handlePasteImport = () => {
    if (!text.trim()) return
    blueprint.importText(text, 'вставка')
  }

  return (
    <section className={styles.panel}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Upload size={15} />
        <span>Загрузить чертёж</span>
        {blueprint.hasImported && <span className={styles.badge}>импорт</span>}
        <X size={14} className={open ? styles.chevronOpen : styles.chevron} />
      </button>

      {open && (
        <div className={styles.body}>
          {/* Зона файла */}
          <div
            className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <FileJson size={20} />
            <p className={styles.dropText}>Перетащите JSON-чертёж сюда</p>
            <label className={styles.fileBtn}>
              Выбрать файл
              <input
                type="file"
                accept=".json,application/json"
                className={styles.fileInput}
                onChange={(e) => {
                  handleFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          {/* Вставка текста */}
          <label className={styles.pasteLabel} htmlFor="blueprint-json">
            Или вставьте JSON:
          </label>
          <textarea
            id="blueprint-json"
            className={styles.textarea}
            placeholder='{"name": "Здание", "floors": [{"rooms": [{"name": "Холл", "type": "hall", "x": 80, "y": 60, "w": 300, "h": 200}]}]}'
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.actionBtn}
            onClick={handlePasteImport}
            disabled={!text.trim()}
          >
            Импортировать из текста
          </button>

          {/* Сброс импорта */}
          <div className={styles.demoRow}>
            {blueprint.hasImported && (
              <button type="button" className={styles.resetBtn} onClick={() => blueprint.clear()}>
                <Eraser size={14} />
                Вернуть «Меридиан»
              </button>
            )}
          </div>

          {/* Статус */}
          {blueprint.lastError && (
            <p className={styles.error} role="alert">
              {blueprint.lastError}
            </p>
          )}
          {blueprint.lastSummary && !blueprint.lastError && (
            <p className={styles.success}>{blueprint.lastSummary}</p>
          )}
        </div>
      )}
    </section>
  )
})

export default ImportPanel
