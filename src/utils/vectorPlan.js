/**
 * СТАДИЯ 5 нового движка: векторная геометрия → черновик этажа.
 *
 * Стадии 1–4 (`wallVectorizer` → `planarRooms` → `planFeatures`) дают стены,
 * комнаты-полигоны, проёмы и марши в координатах картинки. Здесь всё это
 * переносится в сетку приложения 1000×640 и складывается в тот же контракт
 * `blueprint-import`, что отдаёт старый `planExtractor.toRawBlueprint`.
 *
 * Отличие от старого движка по существу: комната приходит сюда ПОЛИГОНОМ
 * (трапеции, скосы, Г-образные), контур здания — обход внешней грани графа
 * стен, а лестница может лежать вне здания и становится объектом этажа.
 */

import { vectorizeWalls } from './wallVectorizer.js'
import { buildRooms } from './planarRooms.js'
import { findOpenings, findStairFlights } from './planFeatures.js'
import { fitPlanTransform, collectDetails } from './planExtractor.js'

/** Полная векторная разборка чертежа. */
export function extractPlanVector(imageData) {
  const started =
    typeof performance !== 'undefined' && performance.now ? performance.now() : null
  const vec = vectorizeWalls(imageData)
  const flights = findStairFlights(vec.rawSegments ?? vec.segments ?? [], vec.w, vec.h)
  const built = buildRooms(vec.walls, vec.w, vec.h)
  const outline = built.outline
  // Промежутки между ступенями — тоже замкнутые грани, и планарный обход
  // честно выдаёт их за помещения: на коттедже из 21 «комнаты» семь были
  // щелями марша размером 47×12. Марш считается один раз, как лестница.
  const shafts = flights.map((f) => {
    const xs = f.treads.flatMap((t) => [t.x1, t.x2])
    const ys = f.treads.flatMap((t) => [t.y1, t.y2])
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    const x1 = Math.max(...xs)
    const y1 = Math.max(...ys)
    // Марш находится не всегда целиком: на коттедже распознались пять ступеней
    // из девяти, и щели остальных снова стали «комнатами». Зону тянем вдоль
    // хода марша — поперёк ступеней, — оставляя ширину по ступени.
    // Ход марша — ПОПЕРЁК ступеней. По пропорциям габарита его не определить:
    // ступени длинные, и коробка марша шире, чем он сам длинный.
    const t0 = f.treads[0]
    const treadHorizontal = Math.abs(t0.x2 - t0.x1) >= Math.abs(t0.y2 - t0.y1)
    const horizontal = !treadHorizontal
    const grow = (horizontal ? x1 - x0 : y1 - y0) * 0.8
    const tread = horizontal ? y1 - y0 : x1 - x0
    return {
      x0: horizontal ? x0 - grow : x0,
      x1: horizontal ? x1 + grow : x1,
      y0: horizontal ? y0 : y0 - grow,
      y1: horizontal ? y1 : y1 + grow,
      tread: Math.max(tread, 1),
    }
  })
  const rooms = built.rooms.filter((r) => {
    const b = bboxOf(r.polygon)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const thin = Math.min(b.w, b.h)
    return !shafts.some(
      (s) => cx >= s.x0 && cx <= s.x1 && cy >= s.y0 && cy <= s.y1 && thin < s.tread,
    )
  })
  const { doors, windows } = findOpenings(vec.walls, vec.inkHard, vec.w, vec.h, rooms)

  // Содержимое комнат — унитазы, раковины, мебель — разбирает общий с старым
  // движком код: геометрия у движков разная, а «что нарисовано внутри
  // комнаты» одно и то же. Ему нужны маска стен и комнаты прямоугольниками.
  const wallMask = rasterizeWalls(vec.walls, vec.w, vec.h)
  const rects = rooms.map((r) => bboxOf(r.polygon))
  const stairMarks = flights.map((f) => ({
    x: (Math.min(...f.treads.map((t) => t.x1)) + Math.max(...f.treads.map((t) => t.x2))) / 2,
    y: (Math.min(...f.treads.map((t) => t.y1)) + Math.max(...f.treads.map((t) => t.y2))) / 2,
  }))
  let details = { sanitary: [], furniture: [], roomMeta: rects.map(() => ({})) }
  try {
    details = collectDetails(vec.ink, wallMask, vec.w, vec.h, rects, stairMarks)
  } catch {
    // разбор содержимого — необязательная часть: геометрия важнее
  }
  const ms =
    started === null
      ? null
      : Math.round((performance.now() - started) * 10) / 10
  return { vec, rooms, outline, doors, windows, flights, details, ms }
}

/** Стены в растровую маску — по ней ищется содержимое комнат. */
function rasterizeWalls(walls, w, h) {
  const mask = new Uint8Array(w * h)
  for (const wall of walls) {
    const dx = wall.x2 - wall.x1
    const dy = wall.y2 - wall.y1
    const len = Math.hypot(dx, dy)
    if (len < 1) continue
    const ux = dx / len
    const uy = dy / len
    const half = Math.max(1, Math.round((wall.thickness ?? 2) / 2))
    for (let t = 0; t <= len; t++) {
      for (let n = -half; n <= half; n++) {
        const x = Math.round(wall.x1 + ux * t - uy * n)
        const y = Math.round(wall.y1 + uy * t + ux * n)
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        mask[y * w + x] = 1
      }
    }
  }
  return mask
}

/** Габариты по всем полигонам комнат (плюс контур, если он есть). */
function extentOf(polys) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (!Number.isFinite(x0)) return null
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/** Габаритный прямоугольник полигона. */
function bboxOf(poly) {
  const e = extentOf([poly])
  return e ?? { x: 0, y: 0, w: 1, h: 1 }
}

/** Площадь по формуле шнурков (модуль). */
function areaOf(poly) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

function inside(poly, x, y) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/**
 * Типы комнат — эвристика, как и в старом движке: подписи не читаются.
 * Коридор — низкая широкая лента, два самых крупных помещения — залы,
 * самые мелкие — служебные, остальное кабинеты.
 */
function assignTypes(rooms, plan) {
  const order = rooms.map((r, i) => ({ i, area: r.area })).sort((a, b) => b.area - a.area)
  const types = rooms.map(() => 'office')
  // Сколько помещений примыкает к каждому. Коридор узнаётся не размерами —
  // лестничная шахта режет его на короткие куски, и порог по длине его
  // не ловит, — а тем, что к нему примыкает много комнат сразу.
  const touch = 8
  const neighbours = rooms.map((r, i) =>
    rooms.reduce((acc, o, j) => {
      if (i === j) return acc
      const a = r.rect
      const b = o.rect
      const near =
        a.x - touch <= b.x + b.w &&
        b.x - touch <= a.x + a.w &&
        a.y - touch <= b.y + b.h &&
        b.y - touch <= a.y + a.h
      return near ? acc + 1 : acc
    }, 0),
  )
  for (let k = 0; k < rooms.length; k++) {
    const r = rooms[k]
    const thin = Math.min(r.rect.w, r.rect.h)
    const long = Math.max(r.rect.w, r.rect.h)
    if (long / thin >= 2.5 && neighbours[k] >= 4 && thin <= plan.h * 0.22) types[k] = 'corridor'
    else if (r.area <= plan.w * plan.h * 0.012) types[k] = 'service'
  }
  let meetings = 0
  for (const { i } of order) {
    if (meetings >= 2) break
    if (types[i] !== 'office') continue
    types[i] = 'meeting'
    meetings++
  }
  return types
}

/** Сторона комнаты, на которой лежит проём. */
function sideFor(rect, op) {
  const horizontal = Math.abs(op.ux) >= Math.abs(op.uy)
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  if (horizontal) return op.y <= cy ? 'top' : 'bottom'
  return op.x <= cx ? 'left' : 'right'
}

/**
 * Черновик этажа из векторной геометрии.
 * @param {ReturnType<typeof extractPlanVector>} v
 * @param {string} [name] — подпись плана
 */
export function toRawBlueprintVector(v, name = 'Конвертер: план из чертежа') {
  const polys = v.rooms.map((r) => r.polygon)
  const bounds = extentOf(v.outline ? [...polys, v.outline] : polys)
  if (!bounds || !v.rooms.length) {
    throw new Error('План не найден: планарный разбор не дал ни одного помещения')
  }
  const { scale, ox, oy } = fitPlanTransform(bounds)
  const tx = (x) => Math.round(x * scale + ox)
  const ty = (y) => Math.round(y * scale + oy)
  const tw = (d) => Math.max(1, Math.round(d * scale))

  const rooms = v.rooms.map((r, i) => {
    const polygon = r.polygon.map(([x, y]) => [tx(x), ty(y)])
    const rect = bboxOf(polygon)
    return { src: i, srcPoly: r.polygon, polygon, rect, area: areaOf(polygon) }
  })
  const plan = extentOf(rooms.map((r) => r.polygon)) ?? { x: 0, y: 0, w: 1, h: 1 }
  const types = assignTypes(rooms, plan)

  const out = rooms.map((r, i) => ({
    name: '',
    type: types[i],
    x: r.rect.x,
    y: r.rect.y,
    w: r.rect.w,
    h: r.rect.h,
    polygon: r.polygon,
    doors: [],
    windows: [],
    features: [],
  }))

  // Проёмы: ищем помещение, к стене которого проём прилегает, и сажаем его
  // на соответствующую грань габарита — Room.jsx рисует двери и окна по side.
  const attach = (op, kind) => {
    const px = tx(op.x)
    const py = ty(op.y)
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < rooms.length; i++) {
      const b = rooms[i].rect
      const dx = Math.max(b.x - px, 0, px - (b.x + b.w))
      const dy = Math.max(b.y - py, 0, py - (b.y + b.h))
      const d = Math.hypot(dx, dy)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0 || bestD > 24) return
    const rect = rooms[best].rect
    const side = sideFor(rect, op)
    const item = {
      x: side === 'left' ? rect.x : side === 'right' ? rect.x + rect.w : px,
      y: side === 'top' ? rect.y : side === 'bottom' ? rect.y + rect.h : py,
      w: Math.max(kind === 'door' ? 18 : 36, tw(op.width)),
      side,
    }
    if (kind === 'door') out[best].doors.push({ ...item, style: 'cross' })
    else out[best].windows.push({ ...item, blue: true })
  }
  for (const d of v.doors) attach(d, 'door')
  for (const wnd of v.windows) attach(wnd, 'window')

  // Сантехника: приборы делают помещение санузлом, бачок унитаза — к стене.
  for (const item of v.details?.sanitary ?? []) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < rooms.length; i++) {
      if (!inside(v.rooms[i].polygon, item.x + item.w / 2, item.y + item.h / 2)) continue
      const b = rooms[i].rect
      const d = Math.hypot(b.x + b.w / 2 - tx(item.x), b.y + b.h / 2 - ty(item.y))
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0) continue
    out[best].type = 'service'
    const src = v.rooms[best].polygon
    const sb = bboxOf(src)
    const cx = item.x + item.w / 2
    const cy = item.y + item.h / 2
    const dl = cx - sb.x
    const dr = sb.x + sb.w - cx
    const dt = cy - sb.y
    const db = sb.y + sb.h - cy
    const m = Math.min(dl, dr, dt, db)
    const tankDir = m === dl ? 'left' : m === dr ? 'right' : m === dt ? 'up' : 'down'
    out[best].features.push({
      type: item.type,
      x: tx(item.x),
      y: ty(item.y),
      w: Math.max(10, tw(item.w)),
      h: Math.max(10, tw(item.h)),
      ...(item.type === 'toilet' ? { tankDir } : { wallDir: tankDir }),
    })
  }

  // Мебель. Подключена после того, как отсев подписей стал строиться по
  // кляксам всего листа: до этого на демо появлялись пять предметов там, где
  // на чертеже нет ни одного. В санузлы мебель не ставим — там приборы.
  for (const f of v.details?.furniture ?? []) {
    const cx = f.x + (f.w ?? 0) / 2
    const cy = f.y + (f.h ?? 0) / 2
    const best = v.rooms.findIndex((r) => inside(r.polygon, cx, cy))
    if (best < 0 || out[best].type === 'service') continue
    if (f.type === 'counter' && f.points) {
      out[best].features.push({
        type: 'counter',
        points: f.points.map(([x, y]) => [tx(x), ty(y)]),
      })
    } else if (f.type === 'table') {
      out[best].features.push({
        type: 'table',
        x: tx(f.x),
        y: ty(f.y),
        r: Math.max(8, tw(f.r ?? Math.max(f.w, f.h) / 2)),
        w: tw(f.w),
        h: tw(f.h),
      })
    } else if (f.type === 'chair') {
      out[best].features.push({
        type: 'chair',
        x: tx(f.x),
        y: ty(f.y),
        w: Math.max(12, tw(f.w)),
        h: Math.max(12, tw(f.h)),
      })
    }
  }

  // Лестницы. Марш внутри помещения — его деталь; марш снаружи (наружное
  // крыльцо) старому движку был недоступен в принципе, здесь он становится
  // объектом этажа и виден на плане.
  const objects = []
  for (const f of v.flights) {
    // Марш целиком вне пятна застройки и не примыкающий к нему — это не
    // лестница, а штриховка на полях чертежа.
    if (v.outline) {
      const anyInside = f.treads.some(
        (t) =>
          inside(v.outline, (t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2) ||
          inside(v.outline, t.x1, t.y1) ||
          inside(v.outline, t.x2, t.y2),
      )
      if (!anyInside) continue
    }
    const xs = f.treads.flatMap((t) => [t.x1, t.x2])
    const ys = f.treads.flatMap((t) => [t.y1, t.y2])
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    const cx = (x0 + Math.max(...xs)) / 2
    const cy = (y0 + Math.max(...ys)) / 2
    const len = Math.max(...xs) - x0
    const span = Math.max(...ys) - y0
    // «Наружная» — та, что вне контура здания. Просто «не попала ни в одну
    // распознанную комнату» не годится: разбор пока находит не все помещения,
    // и внутренний марш уезжал бы на улицу.
    const outdoor = v.outline ? !inside(v.outline, cx, cy) : false
    let host = v.rooms.findIndex((r) => inside(r.polygon, cx, cy))
    if (host < 0 && !outdoor) {
      let bestD = Infinity
      v.rooms.forEach((r, i) => {
        const b = bboxOf(r.polygon)
        const dx = Math.max(b.x - cx, 0, cx - (b.x + b.w))
        const dy = Math.max(b.y - cy, 0, cy - (b.y + b.h))
        const d = Math.hypot(dx, dy)
        if (d < bestD) {
          bestD = d
          host = i
        }
      })
    }
    if (outdoor) host = -1
    if (host >= 0) {
      out[host].features.push({
        type: 'stairs',
        x: tx(x0),
        y: ty(y0),
        step: Math.max(8, tw(span / Math.max(1, f.count - 1))),
        count: f.count,
        len: Math.max(16, tw(len)),
        dir: 'right',
      })
    } else {
      objects.push({ type: 'stairs', x: tx(cx), y: ty(cy), name: 'Наружная лестница' })
    }
  }

  const outline =
    v.outline && v.outline.length >= 3 ? v.outline.map(([x, y]) => [tx(x), ty(y)]) : undefined

  return {
    name,
    floors: [
      {
        level: 1,
        name: '1 этаж — из чертежа',
        bounds: [1000, 640],
        outline,
        rooms: out,
        objects,
      },
    ],
  }
}
