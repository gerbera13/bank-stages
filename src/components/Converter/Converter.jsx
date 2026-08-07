/**
 * Конвертер чертежей — отдельное ПО внутри приложения:
 * 1. Загрузка изображения (drag&drop / выбор файла).
 * 2. Обработка: извлечение геометрии (planExtractor.js) → сырой чертёж.
 * 3. Просмотр «Было / Стало»: исходный чертёж рядом с красивым планом.
 * 4. Экспорт JSON для дальнейшего уточнения (make-stage.md §8.1).
 *
 * Приёмы обработки зафиксированы в make-stage.md §8.5.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Image as ImageIcon, Download, RotateCcw } from 'lucide-react'
import { extractPlan, toRawBlueprint, fitPlanTransform } from '../../utils/planExtractor.js'
import { parseBlueprint } from '../../utils/blueprintParser.js'
import { useStore } from '../../state/storeContext.js'
import FloorPlanSvg from '../FloorPlan/FloorPlanSvg.jsx'
import styles from './Converter.module.css'

/**
 * Прочитать файл изображения в ImageData (через canvas).
 *
 * Вертикальный (портретный) чертёж поворачивается на 90°. Движок разбирает
 * планы в горизонтальной ориентации: подписи ищутся строками, ступени —
 * горизонтальными штрихами, коридор — широкой низкой лентой. На повёрнутом
 * чертеже всё это не срабатывает (проверено: 34 ложных «мебели», лестница и
 * коридор не находятся). Поворачиваем и картинку-исходник, чтобы «Было» и
 * «Стало» лежали одинаково.
 *
 * @param {File} file
 * @returns {Promise<{imageData: ImageData, url: string, rotated: boolean}>}
 */
function readImageData(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      // Ограничим размер, чтобы анализ был быстрым (макс. 1600px по большей стороне)
      const maxSide = 1600
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * ratio))
      const h = Math.max(1, Math.round(img.height * ratio))
      // Явно портретный: квадратные не трогаем — там ориентация не читается
      const rotated = h > w * 1.15
      const canvas = document.createElement('canvas')
      canvas.width = rotated ? h : w
      canvas.height = rotated ? w : h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (rotated) {
        ctx.translate(canvas.width, 0)
        ctx.rotate(Math.PI / 2)
      }
      ctx.drawImage(img, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      if (!rotated) {
        resolve({ imageData, url, rotated })
        return
      }
      // Показываем повёрнутый исходник — иначе панели «Было/Стало» не совпадают
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => {
        resolve({ imageData, url: URL.createObjectURL(blob), rotated })
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Не удалось прочитать изображение.'))
    }
    img.src = url
  })
}

export default function Converter() {
  const { blueprint } = useStore()
  const [originalUrl, setOriginalUrl] = useState(null)
  const [floor, setFloor] = useState(null)
  const [extracted, setExtracted] = useState(null)
  const [error, setError] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [fileName, setFileName] = useState(null)
  // Портретный чертёж развёрнут в горизонт — сообщаем об этом явно
  const [rotated, setRotated] = useState(false)
  // Живой blob-URL исходника: без освобождения он течёт на каждой загрузке
  const urlRef = useRef(null)

  const showOriginal = (url) => {
    if (urlRef.current && urlRef.current !== url) URL.revokeObjectURL(urlRef.current)
    urlRef.current = url
    setOriginalUrl(url)
  }

  const handleImage = async (file) => {
    if (!file) return
    setError(null)
    setFloor(null)
    setExtracted(null)
    try {
      const { imageData: imgData, url, rotated } = await readImageData(file)
      showOriginal(url)
      setFileName(file.name)
      setRotated(rotated)
      process(imgData, file.name)
    } catch (err) {
      setError(err.message)
    }
  }

  const process = (imgData, name) => {
    setProcessing(true)
    setError(null)
    try {
      const ext = extractPlan(imgData)
      setExtracted(ext)
      // Вписать в 1000×640 с полями и чуть меньшим масштабом (весь план виден)
      const { scale, ox, oy } = fitPlanTransform(ext.bounds)
      const raw = toRawBlueprint(ext, scale, ox, oy)
      const building = parseBlueprint(raw)
      setFloor(building.floors[0])
      // Отдаём результат на основной план — там он доступен по кнопке «Чертёж»
      blueprint.acceptConverted(raw, `чертёж «${name}»`)
    } catch (err) {
      setError(err.message)
    } finally {
      setProcessing(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    handleImage(file)
  }

  const handleExport = () => {
    if (!extracted) return
    const { scale, ox, oy } = fitPlanTransform(extracted.bounds)
    const raw = toRawBlueprint(extracted, scale, ox, oy)
    const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    const url = URL.createObjectURL(blob)
    a.href = url
    a.download = 'plan-draft.json'
    a.click()
    // Отпускаем после старта скачивания, иначе Safari отменяет загрузку
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const reset = () => {
    showOriginal(null)
    setFloor(null)
    setExtracted(null)
    setError(null)
    setFileName(null)
    setRotated(false)
  }

  const stats = useMemo(() => {
    if (!extracted) return null
    return {
      mode: extracted.mode === 'color' ? 'цвет' : 'ч/б',
      rooms: extracted.rooms.length,
      doors: extracted.doors.length,
      windows: extracted.windows.length,
      sanitary: extracted.sanitary?.length ?? 0,
      furniture: extracted.furniture?.length ?? 0,
      stairs: extracted.stairs?.length ? String(extracted.stairs.length) : 'нет',
    }
  }, [extracted])

  // Автозагрузка примера при ?demo=1 (для проверки)
  useEffect(() => {
    if (originalUrl || !window.location.search.includes('demo=1')) return
    ;(async () => {
      try {
        const res = await fetch('/demo-plan.png')
        const blob = await res.blob()
        handleImage(new File([blob], 'demo-plan.png', { type: 'image/png' }))
      } catch {
        /* ignore */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Конвертер чертежей</h2>
        <p className={styles.subtitle}>
          Загрузите чертёж (ч/б линии или цветная схема) — получите красивый план.
          Авто-режим: цвет / ч/б. Приёмы: <code>make-stage.md §8.5</code>
        </p>
      </header>

      {!originalUrl ? (
        <div
          className={styles.dropzone}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <ImageIcon size={36} />
          <p className={styles.dropText}>Перетащите чертёж (PNG/JPG) сюда</p>
          <label className={styles.fileBtn}>
            <Upload size={15} />
            Выбрать файл
            <input
              type="file"
              accept="image/*"
              className={styles.fileInput}
              onChange={(e) => {
                handleImage(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={async () => {
              try {
                const res = await fetch('/demo-plan.png')
                if (!res.ok) throw new Error('Пример не найден')
                const blob = await res.blob()
                const file = new File([blob], 'demo-plan.png', { type: 'image/png' })
                handleImage(file)
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            Загрузить пример
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <span className={styles.fileName}>{fileName}</span>
            {stats && (
              <span className={styles.stats}>
                {stats.mode} · комнат {stats.rooms} · дверей {stats.doors} · окон {stats.windows}
                {' · '}сантехника {stats.sanitary} · мебель {stats.furniture}
                {' · '}лестниц: {stats.stairs}
                {rotated && ' · повёрнут на 90°'}
              </span>
            )}
            <button type="button" className={styles.toolBtn} onClick={reset}>
              <RotateCcw size={14} />
              Новый чертёж
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={handleExport}
              disabled={!floor}
            >
              <Download size={14} />
              Экспорт JSON
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}
          {processing && <p className={styles.processing}>Обработка чертежа…</p>}

          {floor && (
            <div className={styles.compare}>
              <section className={styles.pane}>
                <h3 className={styles.paneTitle}>Было — исходный чертёж</h3>
                <div className={styles.imageWrap}>
                  <img src={originalUrl} alt="Исходный чертёж" className={styles.image} />
                </div>
              </section>
              <section className={styles.pane}>
                <h3 className={styles.paneTitle}>Стало — красивый план</h3>
                <div className={`${styles.planWrap} palette-draft`}>
                  <FloorPlanSvg floor={floor} />
                </div>
                <p className={styles.hint}>
                  Черновик: подписи и типы комнат уточняются вручную (make-stage.md §8.1).
                </p>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
