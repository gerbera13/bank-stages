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

/**
 * Убрать мебель ДО заливки — на цветных чертежах.
 *
 * Отсев по цвету границы (см. `colourShare`) не даёт столу стать комнатой, но
 * не спасает саму комнату: заливка обтекает мебель, и полигон кабинета идёт
 * змейкой между столами. Заращивание тут бессильно — вырезы шириной со стол
 * (43 единицы на цветном блоке), а заращивать на столько нельзя, перемахнёт
 * через дверь.
 *
 * Стирать «всё цветное» тоже нельзя, это проверено и провалилось: синим
 * нарисованы ОКНА, они часть наружной стены, и заливка утекает на улицу.
 *
 * Работает точнее: стираем связный кусок чернил, если он ЦЕЛИКОМ цветной.
 * Стол нарисован сам по себе — его кусок весь оранжевый. Перегородка кабинета
 * тоже оранжевая, но упирается в чёрные стены, и кусок выходит смешанный.
 * Окно нарисовано внутри чёрной стены — тот же случай. На ч/б чертежах
 * цветного нет вовсе, и проход ничего не меняет.
 */
function dropFurniture(ink, data, w, h) {
  const seen = new Uint8Array(w * h)
  const stack = []
  const cells = []
  let dropped = 0
  const coloured = (q) => {
    const o = q * 4
    const mx = Math.max(data[o], data[o + 1], data[o + 2])
    const mn = Math.min(data[o], data[o + 1], data[o + 2])
    return mx - mn > 40
  }
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue
    stack.length = 0
    cells.length = 0
    stack.push(start)
    seen[start] = 1
    let allColour = true
    while (stack.length) {
      const p = stack.pop()
      cells.push(p)
      if (!coloured(p)) allColour = false
      const px = p % w
      const py = (p / w) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const q = ny * w + nx
          if (!ink[q] || seen[q]) continue
          seen[q] = 1
          stack.push(q)
        }
      }
    }
    if (allColour) {
      for (const p of cells) ink[p] = 0
      dropped++
    }
  }
  return dropped
}

/**
 * Доля ЦВЕТНЫХ чернил среди тех, что лежат вплотную к границе области.
 *
 * Так отличается мебель от помещения на цветных чертежах. У стола есть белая
 * середина, и она крупнее порога площади — стол становится «комнатой», а на
 * плане обрастает перегородками и дверями. Признак «стол тоньше» не работает
 * (проверено: у настоящих комнат коттеджа граница те же 1–2 пикселя, потому
 * что изнутри их ограничивает тонкая грань двойной стены), «у стола один
 * сосед» — тоже (столы стоят кучно и видят друг друга).
 *
 * А вот цвет разделяет начисто: конструкцию чертят чёрным, мебель — цветом.
 * На демо и коттедже доля ноль у всех помещений, на БТИ не выше 25% (там
 * цветные только выноски), а на цветном блоке двадцать пять областей обведены
 * цветом полностью. Порог высокий: у кабинетов того же блока перегородки тоже
 * оранжевые, и по границе выходит 71–83% — их терять нельзя.
 */
function colourShare(cells, ink, data, w, h, stamp, tag) {
  // Метки вместо двух массивов во весь лист на каждую область: на демо это
  // было 42 выделения по 275 КБ, и разбор заметно тормозил.
  for (const p of cells) stamp[p] = tag
  const seenTag = tag + 1
  let total = 0
  let colour = 0
  for (const p of cells) {
    const px = p % w
    const py = (p / w) | 0
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = px + dx
      const ny = py + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const q = ny * w + nx
      if (stamp[q] === tag || stamp[q] === seenTag || !ink[q]) continue
      stamp[q] = seenTag
      const o = q * 4
      total++
      if (
        Math.max(data[o], data[o + 1], data[o + 2]) -
          Math.min(data[o], data[o + 1], data[o + 2]) >
        40
      )
        colour++
    }
  }
  return total ? colour / total : 0
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
  dropFurniture(ink, imageData.data, w, h)
  const minArea = Math.max(300, w * h * 0.002)

  const regions = fillRegions(ink, w, h)
  const stamp = new Int32Array(w * h)
  let tag = 0
  const lab = new Int32Array(w * h)
  const bodies = []
  let nextId = 1
  for (const r of regions) {
    let id
    if (r.touches) id = OUTSIDE
    else if (
      r.cells.length >= minArea &&
      colourShare(r.cells, ink, imageData.data, w, h, stamp, (tag += 2)) < 0.9
    ) {
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
  const outlines = []
  for (const r of bodies) {
    const b = bboxOfCells(r.cells, w)
    const thin = Math.min(b.w, b.h)
    const long = Math.max(b.w, b.h)
    if (thin <= maxWall && long >= thin * 8) continue
    const mask = new Uint8Array(w * h)
    for (const p of r.cells) mask[p] = 1
    // Проёмы ищем по границе КАК ЕСТЬ: ниша проёма — это и есть их признак.
    // Упрощаем слабее, чем саму комнату: на грубой ломаной ниша пропадает.
    outlines.push(simplify(traceBoundary(mask, w, h), 1.2))
    // А форму комнаты отдаём уже без выемок под приборами — и заодно без
    // зубцов на дверных нишах, которых на плане быть не должно.
    closeNotches(mask, lab, b, w, h, 5)
    const poly = simplify(traceBoundary(mask, w, h), 2)
    if (poly.length < 3) {
      outlines.pop()
      continue
    }
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
  // ВТОРОЙ признак проёма — выступ на границе комнаты. Так выглядит дверь,
  // нарисованная не нишей в стене, а разрывом с дуговым символом: замкнутой
  // щели она не оставляет, зато заливка заходит в проём и границу комнаты
  // ведёт «скобой» — вышла в стену, прошла вдоль, вернулась. На БТИ таких
  // дверей больше половины, и одними щелями находилось 10 из 18.
  for (const poly of outlines) {
    const n = poly.length
    for (let i = 0; i < n; i++) {
      const p0 = poly[i]
      const p1 = poly[(i + 1) % n]
      const p2 = poly[(i + 2) % n]
      const p3 = poly[(i + 3) % n]
      const ax = p1[0] - p0[0]
      const ay = p1[1] - p0[1]
      const bx = p2[0] - p1[0]
      const by = p2[1] - p1[1]
      const cx2 = p3[0] - p2[0]
      const cy2 = p3[1] - p2[1]
      const la = Math.hypot(ax, ay)
      const lb = Math.hypot(bx, by)
      const lc = Math.hypot(cx2, cy2)
      if (la < 1.5 || la > maxT || lc < 1.5 || lc > maxT) continue
      if (lb < minW || lb > maxW) continue
      // боковины скобы примерно равны и смотрят навстречу друг другу
      if (Math.abs(la - lc) > Math.max(2, Math.min(la, lc) * 0.6)) continue
      if (ax * cx2 + ay * cy2 > -0.5 * la * lc) continue
      // перекладина им перпендикулярна, повороты в одну сторону
      if (Math.abs(ax * bx + ay * by) > 0.45 * la * lb) continue
      if ((ax * by - ay * bx) * (bx * cy2 - by * cx2) <= 0) continue
      const mx = (p1[0] + p2[0]) / 2
      const my = (p1[1] + p2[1]) / 2
      // куда смотрит скоба — туда и шагаем за стену
      const nx = ax / la
      const ny = ay / la
      const reach = Math.round(maxT) + Math.round(maxWall) + 4
      const far = probe(lab, w, h, mx, my, nx, ny, reach)
      const back = probe(lab, w, h, mx, my, -nx, -ny, reach)
      if (far === null || far === back) continue
      const door = far > 0 && back > 0
      const window_ = far === OUTSIDE && back > 0
      if (!door && !window_) continue
      found.push({
        x: mx,
        y: my,
        width: Math.round(lb),
        ux: Math.abs(bx) >= Math.abs(by) ? 1 : 0,
        uy: Math.abs(bx) >= Math.abs(by) ? 0 : 1,
        door,
      })
    }
  }

  // Один проём даёт несколько щелей: оконный делится перемычкой надвое,
  // дверной — полотном. Плюс тот же проём находится и щелью, и выступом.
  // Склеиваем близкие; дверь важнее окна.
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
  // Рамки комнат расширяем ровно на 3 — столько `findBlobsInRoom` отступает
  // от рамки внутрь. У векторного движка этот отступ приходится на стену
  // (там рамка идёт по осевой линии), а у заливки — на саму комнату, и
  // срезает ту полоску, где стоит прижатый к стене прибор. Без запаса
  // раковины на демо не находились вовсе; с запасом больше трёх на БТИ рамка
  // захватывает соседнее, и приборов снова меньше (4 → 2).
  const pad = 3
  const rects = rooms.map((r) => {
    const xs = r.polygon.map((p) => p[0])
    const ys = r.polygon.map((p) => p[1])
    const x = Math.max(0, Math.min(...xs) - pad)
    const y = Math.max(0, Math.min(...ys) - pad)
    return {
      x,
      y,
      w: Math.min(w - 1, Math.max(...xs) + pad) - x,
      h: Math.min(h - 1, Math.max(...ys) + pad) - y,
    }
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

/**
 * Зарастить выемки в комнате.
 *
 * Прибор или мебель у стены — это чернила, и заливка их ОБТЕКАЕТ: в полигоне
 * комнаты остаётся вырез размером с раковину. На плане он читается зубцом на
 * стене, которого на чертеже нет.
 *
 * Замыкание (расширить на r, затем сжать обратно) такие бухты затягивает.
 * Но прибавлять разрешаем ТОЛЬКО поверх чернил: через дверной проём (там
 * мелкая белая щель) замыкание иначе перемахнуло бы в соседнюю комнату и
 * склеило их. Работаем в рамке комнаты с запасом — иначе на каждую комнату
 * пришлось бы обходить весь лист.
 */
function closeNotches(mask, lab, box, w, h, r) {
  const x0 = Math.max(0, box.x - r - 1)
  const y0 = Math.max(0, box.y - r - 1)
  const x1 = Math.min(w - 1, box.x + box.w + r)
  const y1 = Math.min(h - 1, box.y + box.h + r)
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const src = new Uint8Array(bw * bh)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (mask[y * w + x]) src[(y - y0) * bw + (x - x0)] = 1
  const closed = morph(morph(src, bw, bh, r, 1), bw, bh, r, 0)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (mask[y * w + x]) continue
      if (lab[y * w + x] !== WALL) continue // только по чернилам
      if (closed[(y - y0) * bw + (x - x0)]) mask[y * w + x] = 1
    }
  }
}

/**
 * Расширить (`grow`) или сжать маску на квадрат со стороной 2r+1.
 *
 * Квадрат раскладывается на два одномерных прохода — сначала по строкам,
 * потом по столбцам, — и это ровно тот же результат за 2·(2r+1) проб вместо
 * (2r+1)². При r=5 разница вчетверо, и она заметна: заращивание выемок идёт
 * по каждой комнате, и в лоб разбор занимал 350 мс на демо.
 */
function morph(src, w, h, r, grow) {
  const pass = (input) => {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1
        for (let d = -r; d <= r; d++) {
          const nx = x + d
          // за краем считаем «пусто» при расширении и «занято» при сжатии:
          // иначе сжатие обгрызало бы рамку кадра
          const s = nx < 0 || nx >= w ? (grow ? 0 : 1) : input[row + nx]
          if (grow ? s : !s) {
            v = grow ? 1 : 0
            break
          }
        }
        out[row + x] = v
      }
    }
    return out
  }
  const byRows = pass(src)
  // тот же проход по столбцам — через транспонирование индексов
  const out = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = grow ? 0 : 1
      for (let d = -r; d <= r; d++) {
        const ny = y + d
        const s = ny < 0 || ny >= h ? (grow ? 0 : 1) : byRows[ny * w + x]
        if (grow ? s : !s) {
          v = grow ? 1 : 0
          break
        }
      }
      out[y * w + x] = v
    }
  }
  return out
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
  // Размыкание: к зданию приклеены обмерные выноски и засечки, и обход тянет
  // за ними длинные пальцы — на БТИ контур выходил в 89 точек. Сжимаем маску
  // и разжимаем обратно: тонкое отваливается, форма здания остаётся. Радиус
  // выше двух ничего не добавляет — оставшиеся 46 точек это уже настоящие
  // уступы. Если размыкание съело здание целиком, берём маску как есть.
  const opened = dilate(erode(body, w, h, 2), w, h, 2)
  let left = 0
  for (let i = 0; i < w * h; i++) if (opened[i]) left++
  const poly = simplify(traceBoundary(left >= minArea ? opened : body, w, h), 2.5)
  return poly.length >= 3 ? poly.map(([x, y]) => [Math.round(x), Math.round(y)]) : null
}

/** Сжать маску на r: клетка остаётся, если целы все её соседи в квадрате r. */
function erode(mask, w, h, r) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      let ok = 1
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) {
            ok = 0
            break
          }
        }
      }
      out[y * w + x] = ok
    }
  }
  return out
}

/** Разжать маску на r — обратная операция к `erode`. */
function dilate(mask, w, h, r) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          out[ny * w + nx] = 1
        }
      }
    }
  }
  return out
}
