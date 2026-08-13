/**
 * ЗАЛИВКА — второй способ разобрать чертёж, обратный векторному.
 *
 * Векторный движок (`vectorPlan.js`) ищет СТЕНЫ: скелет, преобразование Хафа,
 * пары параллельных граней. Отсюда весь его список нерешённого — штриховка
 * (стена есть, а линий нет), светло-серая грань (линия есть, а порог её не
 * берёт), скос (линии есть, а в пару не складываются), толстая стена (две
 * грани, а пустота между ними читается комнатой).
 *
 * Здесь принцип обратный: искать КОМНАТЫ. Комната — большая белая область,
 * замкнутая чем угодно; заливке безразлично, из чего сделана граница. Скос,
 * штриховка, серая линия и толстая стена останавливают её одинаково.
 *
 * Порядок работы:
 *   1. Чернила по мягкому порогу.
 *   2. Связные белые области. Вышедшие на край листа — улица.
 *   3. Крупные области = помещения; граница обводится и упрощается в полигон.
 *   4. Мелкие вытянутые области внутри стен = проёмы. Что по обе стороны:
 *      разные помещения — дверь, помещение и улица — окно, одно и то же
 *      с обеих сторон — не проём (так отсеиваются внутренности букв).
 *
 * Отдаёт ту же форму, что `extractPlanVector`, поэтому черновик этажа из неё
 * собирает общий `toRawBlueprintVector`.
 */

import { vectorizeWalls } from './wallVectorizer.js'
import { findStairFlights } from './planFeatures.js'
import { collectDetails } from './planExtractor.js'

const OUTSIDE = -1
const WALL = 0
const SMALL = -2

/** Мягкая бинаризация — та же, что у векторного движка. */
function inkOf(data, w, h, threshold = 215) {
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    ink[i] = (data[o] + data[o + 1] + data[o + 2]) / 3 < threshold ? 1 : 0
  }
  return ink
}

/**
 * Связные белые области (4-связность: по диагонали заливка не должна
 * протекать сквозь угол стены).
 */
function fillRegions(ink, w, h) {
  const seen = new Uint8Array(w * h)
  const out = []
  const stack = []
  for (let start = 0; start < w * h; start++) {
    if (ink[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    const cells = []
    let touches = false
    while (stack.length) {
      const p = stack.pop()
      const px = p % w
      const py = (p / w) | 0
      cells.push(p)
      if (px === 0 || py === 0 || px === w - 1 || py === h - 1) touches = true
      if (px > 0 && !ink[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1
        stack.push(p - 1)
      }
      if (px < w - 1 && !ink[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1
        stack.push(p + 1)
      }
      if (py > 0 && !ink[p - w] && !seen[p - w]) {
        seen[p - w] = 1
        stack.push(p - w)
      }
      if (py < h - 1 && !ink[p + w] && !seen[p + w]) {
        seen[p + w] = 1
        stack.push(p + w)
      }
    }
    out.push({ cells, touches })
  }
  return out
}

/**
 * Граница области: собираем НАПРАВЛЕННЫЕ рёбра пикселей и сцепляем в цикл.
 * Ребро появляется там, где у клетки области соседа нет. Способ прямолинейный,
 * зато не ошибается на перешейках и сам разделяет внешний контур и дырки —
 * циклов выходит несколько, берём самый длинный.
 */
function traceBoundary(mask, w, h) {
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]
  const key = (x, y) => x * 100000 + y
  const next = new Map()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      if (!on(x, y - 1)) next.set(key(x, y), [x + 1, y])
      if (!on(x + 1, y)) next.set(key(x + 1, y), [x + 1, y + 1])
      if (!on(x, y + 1)) next.set(key(x + 1, y + 1), [x, y + 1])
      if (!on(x - 1, y)) next.set(key(x, y + 1), [x, y])
    }
  }
  const loops = []
  const seen = new Set()
  for (const k of next.keys()) {
    if (seen.has(k)) continue
    const loop = []
    let cur = k
    let guard = 0
    while (!seen.has(cur) && guard++ <= next.size) {
      seen.add(cur)
      const p = next.get(cur)
      if (!p) break
      loop.push(p)
      cur = key(p[0], p[1])
    }
    if (loop.length >= 4) loops.push(loop)
  }
  loops.sort((a, b) => b.length - a.length)
  return loops[0] ?? []
}

/** Упрощение ломаной по Дугласу — Пекеру. */
function simplify(pts, eps) {
  if (pts.length < 4) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let worst = -1
    let worstD = eps
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst > 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

function bboxOfCells(cells, w) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of cells) {
    const x = p % w
    const y = (p / w) | 0
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Кого видно, если шагать от середины щели поперёк неё наружу. */
function probe(lab, w, h, cx, cy, dx, dy, reach) {
  for (let k = 1; k <= reach; k++) {
    const x = Math.round(cx + dx * k)
    const y = Math.round(cy + dy * k)
    if (x < 0 || y < 0 || x >= w || y >= h) return OUTSIDE
    const v = lab[y * w + x]
    if (v !== WALL && v !== SMALL) return v
  }
  return null
}

/**
 * Полный разбор чертежа заливкой.
 * @param {ImageData} imageData
 * @returns форма, совместимая с `extractPlanVector`
 */
export function extractPlanFill(imageData) {
  const started =
    typeof performance !== 'undefined' && performance.now ? performance.now() : null
  const w = imageData.width
  const h = imageData.height
  const minSide = Math.min(w, h)
  const ink = inkOf(imageData.data, w, h)
  const minArea = Math.max(300, w * h * 0.002)

  const regions = fillRegions(ink, w, h)
  const lab = new Int32Array(w * h)
  const bodies = []
  let nextId = 1
  for (const r of regions) {
    let id
    if (r.touches) id = OUTSIDE
    else if (r.cells.length >= minArea) {
      id = nextId++
      bodies.push(r)
    } else id = SMALL
    for (const p of r.cells) lab[p] = id
  }

  // Полоса внутри толстой стены — тоже белая область. Отсекаем тем же
  // признаком, что и в векторном движке: не толще самой толстой стены и
  // сильно вытянута. Настоящий коридор толще — на демо 39 при стенах в 7.
  const vec = vectorizeWalls(imageData)
  const maxWall = vec.walls.reduce((a, s) => Math.max(a, s.thickness ?? 0), 0)

  const rooms = []
  for (const r of bodies) {
    const b = bboxOfCells(r.cells, w)
    const thin = Math.min(b.w, b.h)
    const long = Math.max(b.w, b.h)
    if (thin <= maxWall && long >= thin * 8) continue
    const mask = new Uint8Array(w * h)
    for (const p of r.cells) mask[p] = 1
    const poly = simplify(traceBoundary(mask, w, h), 2)
    if (poly.length < 3) continue
    rooms.push({ polygon: poly.map(([x, y]) => [Math.round(x), Math.round(y)]), area: r.cells.length })
  }
  rooms.sort((a, b) => b.area - a.area)

  // Проёмы: мелкая вытянутая область внутри стены. Ширина в пределах дверной,
  // толщина не больше стены, и заполнена она плотно (иначе это обрывок буквы).
  const minW = minSide * 0.02
  const maxW = minSide * 0.16
  const maxT = minSide * 0.06
  const found = []
  for (const r of regions) {
    if (r.touches || r.cells.length >= minArea || r.cells.length < 8) continue
    const b = bboxOfCells(r.cells, w)
    const long = Math.max(b.w, b.h)
    const thin = Math.min(b.w, b.h)
    if (long < minW || long > maxW || thin > maxT || long < thin * 1.8) continue
    if (r.cells.length < long * thin * 0.55) continue
    const horiz = b.w >= b.h
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const reach = Math.round(maxT) + 4
    const a = probe(lab, w, h, cx, cy, horiz ? 0 : -1, horiz ? -1 : 0, reach)
    const c = probe(lab, w, h, cx, cy, horiz ? 0 : 1, horiz ? 1 : 0, reach)
    if (a === null || c === null || a === c) continue
    const door = a > 0 && c > 0
    const window_ = (a > 0 && c === OUTSIDE) || (c > 0 && a === OUTSIDE)
    if (!door && !window_) continue
    found.push({
      x: cx,
      y: cy,
      width: long,
      ux: horiz ? 1 : 0,
      uy: horiz ? 0 : 1,
      door,
    })
  }
  // Один проём даёт несколько щелей: оконный делится перемычкой надвое,
  // дверной — полотном. Склеиваем близкие; дверь важнее окна.
  const merged = []
  for (const o of found.slice().sort((p) => (p.door ? -1 : 1))) {
    const near = merged.find((m) => Math.hypot(m.x - o.x, m.y - o.y) <= maxT * 1.6)
    if (near) {
      near.width = Math.max(near.width, o.width)
      continue
    }
    merged.push(o)
  }

  // Контур здания — самая большая внешняя область, обведённая изнутри.
  // Проще и надёжнее: обводим объединение всех помещений и проёмов.
  const outline = buildOutline(bodies, ink, w, h, minArea)

  const flights = findStairFlights(vec.ink, w, h)

  // Содержимое комнат разбирает общий код: геометрия у движков разная,
  // а «что нарисовано внутри комнаты» одно и то же.
  const rects = rooms.map((r) => {
    const xs = r.polygon.map((p) => p[0])
    const ys = r.polygon.map((p) => p[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  })
  // Разбору содержимого нужна маска именно СТЕН, а не всех чернил: по ней он
  // отличает раковину-полукруг (её контур замыкается только вместе со стеной)
  // от буквы. Со всеми чернилами приборы не находились вовсе.
  const wallMask = rasterizeWalls(vec.walls, w, h)
  const stairMarks = flights.map((f) => ({
    x: (Math.min(...f.treads.map((t) => t.x1)) + Math.max(...f.treads.map((t) => t.x2))) / 2,
    y: (Math.min(...f.treads.map((t) => t.y1)) + Math.max(...f.treads.map((t) => t.y2))) / 2,
  }))
  let details = { sanitary: [], furniture: [], roomMeta: rects.map(() => ({})) }
  try {
    details = collectDetails(vec.ink, wallMask, w, h, rects, stairMarks)
  } catch {
    // разбор содержимого — необязательная часть: геометрия важнее
  }

  const ms = started === null ? null : Math.round((performance.now() - started) * 10) / 10
  return {
    vec,
    rooms,
    outline,
    doors: merged.filter((o) => o.door),
    windows: merged.filter((o) => !o.door),
    flights,
    details,
    ms,
  }
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

/**
 * Контур застройки: заливаем улицу от края листа, всё остальное — здание.
 * Так контур получается один и с настоящими скосами, без сшивания комнат.
 */
function buildOutline(bodies, ink, w, h, minArea) {
  const outside = new Uint8Array(w * h)
  const stack = []
  for (let x = 0; x < w; x++) {
    for (const p of [x, (h - 1) * w + x]) if (!ink[p] && !outside[p]) { outside[p] = 1; stack.push(p) }
  }
  for (let y = 0; y < h; y++) {
    for (const p of [y * w, y * w + w - 1]) if (!ink[p] && !outside[p]) { outside[p] = 1; stack.push(p) }
  }
  while (stack.length) {
    const p = stack.pop()
    const px = p % w
    const py = (p / w) | 0
    if (px > 0 && !ink[p - 1] && !outside[p - 1]) { outside[p - 1] = 1; stack.push(p - 1) }
    if (px < w - 1 && !ink[p + 1] && !outside[p + 1]) { outside[p + 1] = 1; stack.push(p + 1) }
    if (py > 0 && !ink[p - w] && !outside[p - w]) { outside[p - w] = 1; stack.push(p - w) }
    if (py < h - 1 && !ink[p + w] && !outside[p + w]) { outside[p + w] = 1; stack.push(p + w) }
  }
  // Здание = не улица. Берём связную компоненту, накрывающую самое большое
  // помещение: рамка чертежа и подписи на полях в неё не попадут.
  if (!bodies.length) return null
  const biggest = bodies.reduce((a, b) => (b.cells.length > a.cells.length ? b : a))
  const seed = biggest.cells[0]
  const body = new Uint8Array(w * h)
  body[seed] = 1
  stack.push(seed)
  while (stack.length) {
    const p = stack.pop()
    const px = p % w
    const py = (p / w) | 0
    const step = (i) => {
      if (i < 0 || i >= w * h || outside[i] || body[i]) return
      body[i] = 1
      stack.push(i)
    }
    if (px > 0) step(p - 1)
    if (px < w - 1) step(p + 1)
    if (py > 0) step(p - w)
    if (py < h - 1) step(p + w)
  }
  let count = 0
  for (let i = 0; i < w * h; i++) if (body[i]) count++
  if (count < minArea) return null
  const poly = simplify(traceBoundary(body, w, h), 2.5)
  return poly.length >= 3 ? poly.map(([x, y]) => [Math.round(x), Math.round(y)]) : null
}
