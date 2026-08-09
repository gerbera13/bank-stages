/**
 * Чтение подписей помещений локальной моделью (LM Studio).
 *
 * Единственное, чего пиксельный разбор не может в принципе: движок находит
 * геометрию до пикселя, но букв не читает, и каждый план после конвертации
 * переименовывается руками.
 *
 * Модель спрашиваем ПО ОДНОЙ КОМНАТЕ, вырезкой. Просить у неё координаты
 * бесполезно: на демо она выдаёт подписи верно, но кладёт их в свою внутреннюю
 * сетку — y=456 при высоте картинки 352. Геометрию мы и так знаем точно,
 * поэтому спрашиваем только «что здесь написано».
 *
 * Запрос идёт на /lmstudio — это проход дев-сервера к localhost:1234
 * (см. vite.config.js): напрямую браузер туда не пустит, у LM Studio нет
 * CORS-заголовков. Всё чтение необязательное: не отвечает — работаем без него.
 */

const ENDPOINT = '/lmstudio/v1'

/** Есть ли на месте локальная модель, способная смотреть картинки. */
async function findVisionModel(signal) {
  const res = await fetch(`${ENDPOINT}/models`, { signal })
  if (!res.ok) throw new Error(`LM Studio ответил ${res.status}`)
  const data = await res.json()
  const ids = (data.data ?? []).map((m) => m.id)
  const vision = ids.find((id) => /vl|vision|llava|qwen.*v/i.test(id))
  if (!vision) throw new Error('среди загруженных моделей нет способной читать картинки')
  return vision
}

/**
 * Вырезка одной комнаты, увеличенная — мелкий шрифт иначе не читается.
 * Режем ПО ПОЛИГОНУ комнаты, всё снаружи забеливаем. Прямоугольник тут не
 * годится: с запасом наружу в кадр попадает подпись соседа (на демо комната
 * так получала чужое название «офис 8»), а с отступом внутрь обрезается
 * собственная подпись — пропадали «офис 8» и «Бойлерная».
 */
function cropDataUrl(source, polygon, scale = 3) {
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  const pad = 2
  const x = Math.max(0, Math.round(Math.min(...xs)) - pad)
  const y = Math.max(0, Math.round(Math.min(...ys)) - pad)
  const w = Math.min(source.width - x, Math.round(Math.max(...xs)) - x + pad)
  const h = Math.min(source.height - y, Math.round(Math.max(...ys)) - y + pad)
  if (w < 4 || h < 4) return null
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.beginPath()
  polygon.forEach(([px, py], i) => {
    const cx = (px - x) * scale
    const cy = (py - y) * scale
    if (i === 0) ctx.moveTo(cx, cy)
    else ctx.lineTo(cx, cy)
  })
  ctx.closePath()
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height)
  ctx.restore()
  return canvas.toDataURL('image/png')
}

const PROMPT =
  'Фрагмент плана этажа — одно помещение. Какая подпись написана внутри? ' +
  'Ответь только самой подписью, без пояснений и без площади. ' +
  'Если подписи нет или она нечитаема — ответь: нет.'

async function askOne(model, dataUrl, signal) {
  const res = await fetch(`${ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 60,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`LM Studio ответил ${res.status}`)
  const data = await res.json()
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

/** Ответ модели → подпись или null. */
function cleanName(raw) {
  if (!raw) return null
  // модель иногда добавляет кавычки, точку или пояснение после переноса строки
  let s = raw.split('\n')[0].trim().replace(/^["«]|["».]$/g, '').trim()
  if (!s || /^нет$/i.test(s) || /^no$/i.test(s)) return null
  // Числа на чертеже — это размеры и площади, а не названия: на БТИ-плане так
  // приходили «3.12», «251/4.6», «35 1/2». Целое число оставляем: на планах БТИ
  // помещения нумеруются, и «132» — законная подпись.
  if (/^[\d\s.,]+м/i.test(s)) return null
  if (/\d[.,]\d/.test(s)) return null
  if (s.includes('/')) return null
  if (/^[^\d\s]{1,2}$/.test(s)) return null // одиночная буква — обрывок, не подпись
  if (s.length > 60) s = `${s.slice(0, 57)}…`
  return s
}

/**
 * Прочитать подписи для набора комнат.
 * @param {CanvasImageSource & {width:number,height:number}} source — исходный кадр
 * @param {Array<{polygon: [number,number][]}>} rooms — комнаты В КООРДИНАТАХ КАДРА
 * @param {{ onProgress?: (done:number,total:number)=>void, signal?: AbortSignal,
 *           minSide?: number }} [opts]
 * @returns {Promise<Array<string|null>>} подпись на каждую комнату
 */
export async function readRoomLabels(source, rooms, opts = {}) {
  const { onProgress, signal, minSide = 16 } = opts
  const model = await findVisionModel(signal)
  const out = new Array(rooms.length).fill(null)
  let done = 0
  for (let i = 0; i < rooms.length; i++) {
    if (signal?.aborted) break
    const poly = rooms[i].polygon
    const xs = poly.map((p) => p[0])
    const ys = poly.map((p) => p[1])
    const side = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    // Совсем мелкие комнаты подписей не несут — не тратим на них запрос
    const url = side < minSide ? null : cropDataUrl(source, poly)
    if (!url) {
      onProgress?.(++done, rooms.length)
      continue
    }
    try {
      out[i] = cleanName(await askOne(model, url, signal))
    } catch (err) {
      if (err?.name === 'AbortError') break
      // одна неудачная комната не должна ронять весь проход
    }
    onProgress?.(++done, rooms.length)
  }
  return out
}
