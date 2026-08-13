/**
 * Конвертер чертежей — отдельное ПО внутри приложения:
 * 1. Загрузка изображения (drag&drop / выбор файла).
 * 2. Обработка: извлечение геометрии (vectorPlan.js) → сырой чертёж.
 *
 * Движок один — векторный. Старый растровый разбор по прямоугольникам
 * (`planExtractor.extractPlan`) убран из конвертера: на живых чертежах он
 * давал 8 комнат из 18 на коттедже и 10 из 25 на плане БТИ. Хуже того,
 * именно его результат уходил на основной план — конвертер показывал одно,
 * а приложение получало другое. Сам `planExtractor.js` остаётся: из него
 * по-прежнему берутся разбор содержимого комнат и вписывание в сетку.
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
  ScanText,
} from 'lucide-react'
import { parseBlueprint } from '../../utils/blueprintParser.js'
import { extractPlanVector, toRawBlueprintVector } from '../../utils/vectorPlan.js'
import { readRoomLabels } from '../../utils/labelReader.js'
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
  // Разобранный этаж и сырой чертёж — результат векторного движка.
  const [floorNew, setFloorNew] = useState(null)
  const [rawNew, setRawNew] = useState(null)
  // Чтение подписей локальной моделью: необязательная возможность.
  // Кадр держим канвой — из него нарезаются вырезки комнат.
  const frameRef = useRef(null)
  const [reading, setReading] = useState(null)
  const [readError, setReadError] = useState(null)
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
    try {
      const { imageData: imgData, url, rotated } = await readImageData(file)
      const canvas = document.createElement('canvas')
      canvas.width = imgData.width
      canvas.height = imgData.height
      canvas.getContext('2d').putImageData(imgData, 0, 0)
      frameRef.current = canvas
      setReadError(null)
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
      // Один и тот же разбор и для наложений, и для панели «Стало» —
      // иначе счётчики на кнопках расходятся с тем, что нарисовано.
      const parsed = extractPlanVector(imgData)
      setVectors(parsed.vec)
      setNewRooms({ rooms: parsed.rooms, outline: parsed.outline })
      setFeats({ doors: parsed.doors, windows: parsed.windows, flights: parsed.flights })
      const raw = toRawBlueprintVector(parsed, `Конвертер: ${name}`)
      setRawNew(raw)
      setFloorNew(parseBlueprint(raw).floors[0])
      // Отдаём результат на основной план — там он доступен по кнопке «Чертёж».
      // Раньше сюда уходил разбор СТАРОГО движка: конвертер показывал одно,
      // а приложение получало другое — на коттедже 8 комнат вместо 18.
      blueprint.acceptConverted(raw, `чертёж «${name}»`)
    } catch (err) {
      setError(err.message)
      setVectors(null)
      setNewRooms(null)
      setFeats(null)
      setRawNew(null)
      setFloorNew(null)
    } finally {
      setProcessing(false)
    }
  }

  // Прочитать подписи помещений локальной моделью и подставить их в план.
  // Порядок комнат у разбора и у готового этажа один и тот же, поэтому
  // подписи ложатся по индексу.
  const handleReadLabels = async () => {
    if (!frameRef.current || !newRooms || !rawNew) return
    setReadError(null)
    setReading({ done: 0, total: newRooms.rooms.length })
    try {
      const names = await readRoomLabels(frameRef.current, newRooms.rooms, {
        onProgress: (done, total) => setReading({ done, total }),
      })
      const raw = {
        ...rawNew,
        floors: rawNew.floors.map((f) => ({
          ...f,
          rooms: f.rooms.map((r, i) => (names[i] ? { ...r, name: names[i] } : r)),
        })),
      }
      setRawNew(raw)
      setFloorNew(parseBlueprint(raw).floors[0])
    } catch (err) {
      setReadError(err.message)
    } finally {
      setReading(null)
    }
  }


  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    handleImage(file)
  }

  const handleExport = () => {
    if (rawNew) downloadJson(rawNew)
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
    setError(null)
    setFileName(null)
    setRotated(false)
    setFloorNew(null)
    setRawNew(null)
    setReading(null)
    setReadError(null)
    frameRef.current = null
    setVectors(null)
    setNewRooms(null)
    setFeats(null)
  }

  // Цифры описывают ТОТ разбор, что показан справа: иначе строка под именем
  // файла рассказывает про один движок, а панель «Стало» рисует другой.
  const stats = useMemo(() => {
    if (floorNew) {
      const rooms = floorNew.rooms
      return {
        mode: 'вектор',
        rooms: rooms.length,
        doors: rooms.reduce((a, r) => a + r.doors.length, 0),
        windows: rooms.reduce((a, r) => a + r.windows.length, 0),
        sanitary: rooms.reduce(
          (a, r) => a + (r.features ?? []).filter((f) => f.type === 'toilet' || f.type === 'sink').length,
          0,
        ),
        furniture: rooms.reduce(
          (a, r) =>
            a + (r.features ?? []).filter((f) => ['chair', 'table', 'counter'].includes(f.type)).length,
          0,
        ),
        stairs: String(
          rooms.reduce((a, r) => a + (r.features ?? []).filter((f) => f.type === 'stairs').length, 0) +
            (floorNew.objects ?? []).filter((o) => o.type === 'stairs').length,
        ),
      }
    }
    return null
  }, [floorNew])

  // Автозагрузка примера при ?demo=… (для проверки): 1 — офисный этаж,
  // 11 — коттедж, 12 — план БТИ. Три чертежа устроены по-разному, и правка,
  // которая чинит один, часто ломает другой, — держим их под рукой.
  useEffect(() => {
    const which = new URLSearchParams(window.location.search).get('demo')
    if (originalUrl || !which) return
    const name = which === '1' ? 'demo-plan.png' : `demo-${which}.png`
    ;(async () => {
      try {
        const res = await fetch(`/${name}`)
        if (!res.ok) return
        const blob = await res.blob()
        handleImage(new File([blob], name, { type: 'image/png' }))
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
              className={styles.toolBtn}
              onClick={handleReadLabels}
              disabled={!floorNew || reading !== null}
              title="Прочитать названия помещений локальной моделью (LM Studio). Работает, только если она запущена."
            >
              <ScanText size={14} />
              {reading ? `Читаю подписи ${reading.done}/${reading.total}` : 'Прочитать подписи'}
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={handleExport}
              disabled={!rawNew}
            >
              <Download size={14} />
              Экспорт JSON
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}
          {readError && (
            <p className={styles.error}>
              Подписи не прочитаны: {readError}. Проверьте, запущен ли LM Studio и загружена
              ли в него модель, умеющая смотреть картинки.
            </p>
          )}
          {processing && <p className={styles.processing}>Обработка чертежа…</p>}

          {floorNew && (
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
                  <FloorPlanSvg floor={floorNew} />
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
