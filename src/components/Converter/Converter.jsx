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
import {
  Upload,
  Image as ImageIcon,
  Download,
  RotateCcw,
  Ruler,
  Grid2x2,
  DoorOpen,
  Cpu,
} from 'lucide-react'
import { extractPlan, toRawBlueprint, fitPlanTransform } from '../../utils/planExtractor.js'
import { parseBlueprint } from '../../utils/blueprintParser.js'
import { vectorizeWalls } from '../../utils/wallVectorizer.js'
import { buildRooms } from '../../utils/planarRooms.js'
import { findOpenings, findStairFlights } from '../../utils/planFeatures.js'
import { toRawBlueprintVector } from '../../utils/vectorPlan.js'
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
  // Первая веха нового движка: найденные стены поверх исходника (только показ)
  const [vectors, setVectors] = useState(null)
  const [showVectors, setShowVectors] = useState(false)
  const [newRooms, setNewRooms] = useState(null)
  const [showRooms, setShowRooms] = useState(false)
  const [feats, setFeats] = useState(null)
  const [showFeats, setShowFeats] = useState(false)
  // Стадия 5: тот же чертёж, разобранный новым движком целиком.
  // Держим оба результата рядом — движки сравниваются переключателем.
  const [floorNew, setFloorNew] = useState(null)
  const [rawNew, setRawNew] = useState(null)
  const [engine, setEngine] = useState('old')
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
      // Векторизатор работает на том же кадре — наложение совпадёт с «Было»
      try {
        const v = vectorizeWalls(imgData)
        const built = buildRooms(v.walls, v.w, v.h)
        setVectors(v)
        setNewRooms(built)
        const found = {
          ...findOpenings(v.walls, v.inkHard, v.w, v.h, built.rooms),
          flights: findStairFlights(v.rawSegments, v.w, v.h),
        }
        setFeats(found)
        try {
          const rawV = toRawBlueprintVector(
            { vec: v, rooms: built.rooms, outline: built.outline, ...found },
            `Конвертер (новый движок): ${name}`,
          )
          setRawNew(rawV)
          setFloorNew(parseBlueprint(rawV).floors[0])
        } catch {
          setRawNew(null)
          setFloorNew(null)
        }
      } catch {
        setVectors(null)
        setNewRooms(null)
        setFeats(null)
        setRawNew(null)
        setFloorNew(null)
      }
      // Отдаём результат на основной план — там он доступен по кнопке «Чертёж»
      blueprint.acceptConverted(raw, `чертёж «${name}»`)
    } catch (err) {
      setError(err.message)
    } finally {
      setProcessing(false)
    }
  }

  // Какой разбор показываем справа. Пока движки живут параллельно:
  // старый — опорный результат, новый — проверяемый.
  const shownFloor = engine === 'new' && floorNew ? floorNew : floor

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    handleImage(file)
  }

  const handleExport = () => {
    if (engine === 'new' && rawNew) {
      downloadJson(rawNew)
      return
    }
    if (!extracted) return
    const { scale, ox, oy } = fitPlanTransform(extracted.bounds)
    const raw = toRawBlueprint(extracted, scale, ox, oy)
    downloadJson(raw)
  }

  const downloadJson = (raw) => {
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
    setFloorNew(null)
    setRawNew(null)
    setEngine('old')
    setVectors(null)
    setNewRooms(null)
    setFeats(null)
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
              className={`${styles.toolBtn} ${showVectors ? styles.toolBtnOn : ''}`}
              onClick={() => setShowVectors((v) => !v)}
              disabled={!vectors}
              title="Первая веха нового движка: найденные стены поверх исходника"
            >
              <Ruler size={14} />
              Стены{vectors ? ` (${vectors.walls.length})` : ''}
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${showRooms ? styles.toolBtnOn : ''}`}
              onClick={() => setShowRooms((v) => !v)}
              disabled={!newRooms}
              title="Стадия 3: комнаты как грани планарного разбиения"
            >
              <Grid2x2 size={14} />
              Комнаты{newRooms ? ` (${newRooms.rooms.length})` : ''}
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${showFeats ? styles.toolBtnOn : ''}`}
              onClick={() => setShowFeats((v) => !v)}
              disabled={!feats}
              title="Стадия 4: двери, окна и лестницы из векторной геометрии"
            >
              <DoorOpen size={14} />
              Проёмы
              {feats ? ` (${feats.doors.length}/${feats.windows.length}/${feats.flights.length})` : ''}
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${engine === 'new' ? styles.toolBtnOn : ''}`}
              onClick={() => setEngine((e) => (e === 'new' ? 'old' : 'new'))}
              disabled={!floorNew}
              title="Чем построена панель «Стало»: старый разбор по прямоугольникам или новый векторный"
            >
              <Cpu size={14} />
              Движок: {engine === 'new' ? 'новый' : 'старый'}
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
                  <div className={styles.imageStack}>
                    <img src={originalUrl} alt="Исходный чертёж" className={styles.image} />
                    {showRooms && newRooms && vectors && (
                      <svg
                        className={styles.overlay}
                        viewBox={`0 0 ${vectors.w} ${vectors.h}`}
                        preserveAspectRatio="none"
                      >
                        {newRooms.rooms.map((room, i) => (
                          <polygon
                            key={i}
                            points={room.polygon.map((p) => p.join(',')).join(' ')}
                            fill={`hsl(${(i * 47) % 360} 70% 60% / 0.35)`}
                            stroke={`hsl(${(i * 47) % 360} 70% 40%)`}
                            strokeWidth="1.5"
                          />
                        ))}
                      </svg>
                    )}
                    {showFeats && feats && vectors && (
                      <svg
                        className={styles.overlay}
                        viewBox={`0 0 ${vectors.w} ${vectors.h}`}
                        preserveAspectRatio="none"
                      >
                        {feats.flights.flatMap((f, fi) =>
                          f.treads.map((t, ti) => (
                            <line
                              key={`s${fi}-${ti}`}
                              x1={t.x1}
                              y1={t.y1}
                              x2={t.x2}
                              y2={t.y2}
                              stroke="#7c3aed"
                              strokeWidth="2"
                            />
                          )),
                        )}
                        {feats.doors.map((d, i) => (
                          <circle key={`d${i}`} cx={d.x} cy={d.y} r={Math.max(3, d.width / 2)} fill="#16a34a" fillOpacity="0.75" />
                        ))}
                        {feats.windows.map((win, i) => (
                          <circle key={`w${i}`} cx={win.x} cy={win.y} r={Math.max(3, win.width / 2)} fill="#0284c7" fillOpacity="0.75" />
                        ))}
                      </svg>
                    )}
                    {showVectors && vectors && (
                      <svg
                        className={styles.overlay}
                        viewBox={`0 0 ${vectors.w} ${vectors.h}`}
                        preserveAspectRatio="none"
                      >
                        {vectors.walls.map((wall, i) => (
                          <line
                            key={i}
                            x1={wall.x1}
                            y1={wall.y1}
                            x2={wall.x2}
                            y2={wall.y2}
                            stroke={wall.paired ? '#e11d48' : '#0ea5e9'}
                            strokeWidth={wall.paired ? 2 : 1}
                            strokeOpacity="0.85"
                          />
                        ))}
                      </svg>
                    )}
                  </div>
                </div>
              </section>
              <section className={styles.pane}>
                <h3 className={styles.paneTitle}>Стало — красивый план</h3>
                <div className={`${styles.planWrap} palette-draft`}>
                  <FloorPlanSvg floor={shownFloor} />
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
