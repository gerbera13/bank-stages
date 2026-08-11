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
  const flights = findStairFlights(vec.ink, vec.w, vec.h)
  // Зона марша: по ней отличаем ступени и щели между ними от настоящих стен
  // и комнат. Считаем её ДО разбора на комнаты — ступени надо убрать и оттуда.
  const shafts = flights.map((f) => {
    const xs = f.treads.flatMap((t) => [t.x1, t.x2])
    const ys = f.treads.flatMap((t) => [t.y1, t.y2])
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    const x1 = Math.max(...xs)
    const y1 = Math.max(...ys)
    // Ход марша — ПОПЕРЁК ступеней. По пропорциям габарита его не определить:
    // ступени длинные, и коробка марша шире, чем он сам длинный. Вдоль хода
    // зону тянем: марш находится не всегда целиком, и щели остальных ступеней
    // иначе снова становятся «комнатами».
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
      treadAxis: treadHorizontal ? 'x' : 'y',
    }
  })

  // Ступень — короткая линия внутри зоны марша. Из стен её надо убрать дважды:
  // из поиска проёмов (иначе разрывы на ступенях становятся окнами) и из
  // разбора на комнаты (иначе ступени режут шахту на ломтики — отделялась
  // четверть марша, и обломок читался голубым пятном в начале лестницы).
  // Поле добавляем ТОЛЬКО вдоль ступеней: по ходу марша зона и так растянута,
  // а поле во все стороны съедало настоящие стены — на коттедже пропадали
  // четыре двери. Запас по длине нужен торцевой стене шахты: она чуть длиннее
  // ступени (41 против 26 на демо).
  const inShaft = (wall, factor) => {
    const cx = (wall.x1 + wall.x2) / 2
    const cy = (wall.y1 + wall.y2) / 2
    const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
    return shafts.some((s) => {
      const mx = s.treadAxis === 'x' ? s.tread * 0.5 : 0
      const my = s.treadAxis === 'y' ? s.tread * 0.5 : 0
      return (
        cx >= s.x0 - mx &&
        cx <= s.x1 + mx &&
        cy >= s.y0 - my &&
        cy <= s.y1 + my &&
        len <= s.tread * factor
      )
    })
  }
  // Два РАЗНЫХ порога, и это важно.
  // Для проёмов — широкий (2×): под него попадает и торцевая стена шахты,
  // на которой иначе появляется окно в конце лестницы, которого нет на чертеже.
  // Для разбора на комнаты — узкий (1.3×): торцевую стену надо СОХРАНИТЬ, она
  // отделяет кладовую под лестницей. Ступень на демо 26 единиц, торцевая
  // стена 41 — порог 34 разводит их надёжно.
  const wallsForOpenings = vec.walls.filter((wall) => !inShaft(wall, 2))
  const wallsForRooms = vec.walls.filter((wall) => !inShaft(wall, 1.3))

  // Стены лестничного проёма тянем до конца. На демо они начинаются с y164,
  // а верхняя стена коридора на y144: общего дотягивания концов (18 единиц)
  // не хватает двух пикселей, стены не смыкаются с коридором — и проём
  // остаётся без боковых стен на всём протяжении коридора. Поднимать общее
  // дотягивание нельзя: на БТИ стены начинают цепляться где попало и комнат
  // выходит 36 вместо 27. Поэтому удлиняем ТОЛЬКО те стены, что образуют
  // проём: они по смыслу идут во всю его высоту.
  const toStretch = new Set()
  for (const s of shafts) {
    const runVertical = s.treadAxis === 'x'
    // стены, идущие ВДОЛЬ хода марша и стоящие в его полосе
    const cand = wallsForRooms.filter((wall) => {
      const dx = wall.x2 - wall.x1
      const dy = wall.y2 - wall.y1
      if (Math.hypot(dx, dy) < s.tread) return false
      if (runVertical ? Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > Math.abs(dx)) return false
      const cx = (wall.x1 + wall.x2) / 2
      const cy = (wall.y1 + wall.y2) / 2
      const side = runVertical ? cx : cy
      const mid = runVertical ? cy : cx
      const lo = (runVertical ? s.x0 : s.y0) - s.tread
      const hi = (runVertical ? s.x1 : s.y1) + s.tread
      const a = (runVertical ? s.y0 : s.x0) - s.tread
      const b = (runVertical ? s.y1 : s.x1) + s.tread
      return side >= lo && side <= hi && mid > a && mid < b
    })
    if (cand.length < 2) continue
    // Удлиняем только КРАЙНИЕ из них. Между ними идёт тетива марша — если
    // потянуть и её, шахта разрежется пополам, а с ней и кладовая внизу.
    const pos = (wall) => (runVertical ? (wall.x1 + wall.x2) / 2 : (wall.y1 + wall.y2) / 2)
    const sorted = cand.slice().sort((a, b) => pos(a) - pos(b))
    toStretch.add(sorted[0])
    toStretch.add(sorted[sorted.length - 1])
  }
  const stretched = wallsForRooms.map((wall) => {
    if (!toStretch.has(wall)) return wall
    const dx = wall.x2 - wall.x1
    const dy = wall.y2 - wall.y1
    const len = Math.hypot(dx, dy) || 1
    const tread = shafts.length ? shafts[0].tread : 20
    const g = (tread * 1.5) / len
    return {
      ...wall,
      x1: wall.x1 - dx * g,
      y1: wall.y1 - dy * g,
      x2: wall.x2 + dx * g,
      y2: wall.y2 + dy * g,
    }
  })
  const built = buildRooms(stretched, vec.w, vec.h)
  const outline = built.outline
  const rooms = built.rooms.filter((r) => {
    const b = bboxOf(r.polygon)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    return !shafts.some((s) => {
      if (cx < s.x0 || cx > s.x1 || cy < s.y0 || cy > s.y1) return false
      // Щель между ступенями тонкая ВДОЛЬ ХОДА марша. Сама шахта по этой оси
      // длинная — раньше её мерили по короткой стороне и отбрасывали вместе
      // со щелями, из-за чего лестница не выделялась в отдельное помещение.
      const along = s.treadAxis === 'x' ? b.h : b.w
      return along < s.tread
    })
  })
  const { doors, windows } = findOpenings(
    wallsForOpenings,
    vec.inkHard,
    vec.w,
    vec.h,
    rooms
  )

  // Содержимое комнат — унитазы, раковины, мебель — разбирает общий с старым
  // движком код: геометрия у движков разная, а «что нарисовано внутри
  // комнаты» одно и то же. Ему нужны маска стен и комнаты прямоугольниками.
  const wallMask = rasterizeWalls(vec.walls, vec.w, vec.h)
  const rects = rooms.map((r) => bboxOf(r.polygon))
  const stairMarks = flights.map((f) => ({
    x:
      (Math.min(...f.treads.map((t) => t.x1)) + Math.max(...f.treads.map((t) => t.x2))) /
      2,
    y:
      (Math.min(...f.treads.map((t) => t.y1)) + Math.max(...f.treads.map((t) => t.y2))) /
      2,
  }))
  let details = { sanitary: [], furniture: [], roomMeta: rects.map(() => ({})) }
  try {
    details = collectDetails(vec.ink, wallMask, vec.w, vec.h, rects, stairMarks)
  } catch {
    // разбор содержимого — необязательная часть: геометрия важнее
  }
  const ms = started === null ? null : Math.round((performance.now() - started) * 10) / 10
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
    }, 0)
  )
  for (let k = 0; k < rooms.length; k++) {
    const r = rooms[k]
    const thin = Math.min(r.rect.w, r.rect.h)
    const long = Math.max(r.rect.w, r.rect.h)
    // Толщину ленты меряем по площади и периметру (2·S/P), а не по короткой
    // стороне габарита. У Г-образного коридора габарит включает отросток
    // лестницы, короткая сторона выходит 183 вместо 58, и коридор переставал
    // считаться коридором.
    let perim = 0
    for (let q = 0; q < r.polygon.length; q++) {
      const [ax, ay] = r.polygon[q]
      const [bx, by] = r.polygon[(q + 1) % r.polygon.length]
      perim += Math.hypot(bx - ax, by - ay)
    }
    const band = perim > 0 ? (2 * r.area) / perim : thin
    if (long / band >= 3 && neighbours[k] >= 6 && band <= plan.h * 0.22)
      types[k] = 'corridor'
    // Служебным помещение делает САНТЕХНИКА, а не размер: её находит
    // `collectDetails` и сама выставляет тип. По размеру на плане БТИ
    // служебными становились пятнадцать комнат из двадцати пяти — план
    // выглядел сплошным санузлом. Порог оставляем только для совсем
    // крошечных каморок: кладовых и шкафов.
    else if (r.area <= plan.w * plan.h * 0.004) types[k] = 'service'
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

/**
 * Сторона комнаты, на которой лежит проём — по САМОЙ ФОРМЕ комнаты, а не по
 * центру её габарита. Полигон и проём принимаем в координатах чертежа.
 *
 * По центру габарита выходит неверно на всякой не-прямоугольной комнате.
 * Коридор на демо Г-образный: габарит y291..432, центр 361, а сама лента
 * y291..349. Все четыре двери нижнего ряда стоят у её нижнего края, но выше
 * центра габарита — и уезжали на верхнюю грань, то есть пропадали с глаз.
 *
 * Здесь смотрим, с какой стороны от проёма лежит тело комнаты: если ниже —
 * проём на её верхней грани, если выше — на нижней.
 */
function sideForRoom(poly, op, step) {
  const horizontal = Math.abs(op.ux) >= Math.abs(op.uy)
  const nx = -op.uy
  const ny = op.ux
  const plus = inside(poly, op.x + nx * step, op.y + ny * step)
  const minus = inside(poly, op.x - nx * step, op.y - ny * step)
  // нормаль (nx,ny) при горизонтальной стене смотрит вниз по оси Y
  if (horizontal) {
    if (plus && !minus) return ny > 0 ? 'top' : 'bottom'
    if (minus && !plus) return ny > 0 ? 'bottom' : 'top'
    return 'top'
  }
  if (plus && !minus) return nx > 0 ? 'left' : 'right'
  if (minus && !plus) return nx > 0 ? 'right' : 'left'
  return 'left'
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

  // Игла в полигоне: короткая грань, на которой обход разворачивается назад.
  // На демо коридор выходил с зигзагом [435,349]→[398,384]→[410,378]→[410,432]
  // — вылазка вниз-влево и тут же обратно. Это шум обхода, а не форма комнаты.
  const dropSpikes = (poly, tol = 16) => {
    if (poly.length <= 4) return poly
    const out = poly.map(([x, y]) => [x, y])
    for (let i = out.length - 1; i >= 0 && out.length > 4; i--) {
      const p = out[(i + out.length - 1) % out.length]
      const c = out[i]
      const n = out[(i + 1) % out.length]
      const inLen = Math.hypot(c[0] - p[0], c[1] - p[1])
      const outLen = Math.hypot(n[0] - c[0], n[1] - c[1])
      if (Math.min(inLen, outLen) > tol) continue
      // разворот: входящее и исходящее направления смотрят навстречу
      const dot =
        ((c[0] - p[0]) * (n[0] - c[0]) + (c[1] - p[1]) * (n[1] - c[1])) /
        (Math.max(inLen, 1e-6) * Math.max(outLen, 1e-6))
      if (dot < -0.3) out.splice(i, 1)
    }
    return out
  }

  // Грань комнаты с уклоном в пару единиц — след того, что вершины графа
  // склеивались с допуском. Глазом это читается как непараллельные стены.
  // Выравниваем только почти прямые грани: настоящий скос не трогаем.
  // Двумя проходами: выравнивание одной грани сдвигает вершину следующей,
  // и за один круг остаток не сходится.
  const straighten = (poly, tol = 3) => {
    const out = poly.map(([x, y]) => [x, y])
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < out.length; i++) {
        const a = out[i]
        const b = out[(i + 1) % out.length]
        const dx = Math.abs(b[0] - a[0])
        const dy = Math.abs(b[1] - a[1])
        if (dx > tol && dy > 0 && dy <= tol) {
          const y = Math.round((a[1] + b[1]) / 2)
          a[1] = y
          b[1] = y
        } else if (dy > tol && dx > 0 && dx <= tol) {
          const x = Math.round((a[0] + b[0]) / 2)
          a[0] = x
          b[0] = x
        }
      }
    return out
  }

  const rooms = v.rooms.map((r, i) => {
    const polygon = straighten(dropSpikes(r.polygon.map(([x, y]) => [tx(x), ty(y)])))
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
  // Расстояние от точки до контура комнаты. По габариту считать нельзя:
  // у Г-образной комнаты точка бывает внутри габарита, но вне самой комнаты,
  // и проём привязывался к ней, повисая в пустоте.
  const nearestOnOutline = (poly, px, py) => {
    let best = { d: Infinity, x: px, y: py }
    for (let k = 0; k < poly.length; k++) {
      const [ax, ay] = poly[k]
      const [bx, by] = poly[(k + 1) % poly.length]
      const vx = bx - ax
      const vy = by - ay
      const l2 = vx * vx + vy * vy || 1
      let t = ((px - ax) * vx + (py - ay) * vy) / l2
      t = Math.max(0, Math.min(1, t))
      const qx = ax + vx * t
      const qy = ay + vy * t
      const d = Math.hypot(px - qx, py - qy)
      if (d < best.d) best = { d, x: qx, y: qy }
    }
    return best
  }
  const distToOutline = (poly, px, py) => nearestOnOutline(poly, px, py).d

  const attach = (op, kind) => {
    const px = tx(op.x)
    const py = ty(op.y)
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < rooms.length; i++) {
      const d = distToOutline(rooms[i].polygon, px, py)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0 || bestD > 24) return
    const probe = Math.max(4, Math.round(Math.min(v.vec.w, v.vec.h) * 0.03))
    const side = sideForRoom(v.rooms[best].polygon, op, probe)
    // Садим проём ровно на контур комнаты. Осевая линия стены и граница
    // помещения совпадают не всегда: выравнивание граней по осям и чистка игл
    // сдвигают полигон, и проём повисал в стороне — на коттедже ровно на 10
    // единиц, на БТИ до 21.
    const snap = nearestOnOutline(rooms[best].polygon, px, py)
    // Положение оставляем настоящее, а не притянутое к габариту: у Г-образной
    // комнаты грань идёт не по габариту, и притягивание уводило проём в стену.
    const item = {
      x: Math.round(snap.x),
      y: Math.round(snap.y),
      w: Math.max(kind === 'door' ? 18 : 36, tw(op.width)),
      side,
    }
    // Двойная стена даёт две грани, и проём в ней находится дважды — по разу
    // на каждой. Повтор виден как две двери в пяти единицах друг от друга.
    const list = kind === 'door' ? 'doors' : 'windows'
    const near = out.some((r) =>
      // Радиус небольшой и не зависит от ширины: окна бывают широкими и идут
      // подряд по стене — по половине их ширины склеивались соседние.
      r[list].some((o) => Math.hypot(o.x - item.x, o.y - item.y) < 10),
    )
    if (near) return
    if (kind === 'door') out[best].doors.push({ ...item, style: 'cross' })
    else out[best].windows.push({ ...item, blue: true })
  }
  for (const d of v.doors) attach(d, 'door')
  for (const wnd of v.windows) attach(wnd, 'window')

  // Вход на лестницу. Марш примыкает к коридору широким проёмом между двумя
  // своими боковыми стенами — на демо это 40 px. Разрывом стены его не увидеть:
  // с той стороны стены просто нет, а проём ищется как перерыв в сплошной
  // линии. Ставим две двери по краям этого проёма — так на чертеже и читается
  // вход на лестницу.
  for (const f of v.flights) {
    const t0 = f.treads[0]
    const treadHorizontal = Math.abs(t0.x2 - t0.x1) >= Math.abs(t0.y2 - t0.y1)
    const xs = f.treads.flatMap((t) => [t.x1, t.x2])
    const ys = f.treads.flatMap((t) => [t.y1, t.y2])
    const a0 = treadHorizontal ? Math.min(...xs) : Math.min(...ys)
    const a1 = treadHorizontal ? Math.max(...xs) : Math.max(...ys)
    const bTop = treadHorizontal ? Math.min(...ys) : Math.min(...xs)
    const width = Math.max(18, tw((a1 - a0) * 0.35))
    // Комнату и линию входа берём ОДИН раз — по середине торца марша. Иначе
    // каждая из двух дверей притягивается к контуру сама по себе и обе
    // сходятся в одну точку.
    const midA = (a0 + a1) / 2
    const px0 = treadHorizontal ? tx(midA) : tx(bTop)
    const py0 = treadHorizontal ? ty(bTop) : ty(midA)
    // Комната лестницы — та, что СОДЕРЖИТ марш. По близости к контуру
    // выходило иначе: точка входа лежит ровно между проёмом и коридором,
    // расстояния равны, и дверь уходила к коридору вместо проёма.
    const cMid = [tx((a0 + a1) / 2), ty((bTop + (treadHorizontal ? Math.max(...ys) : Math.max(...xs))) / 2)]
    let best = rooms.findIndex((r) => inside(r.polygon, cMid[0], cMid[1]))
    if (best < 0) {
      let bestD = Infinity
      for (let i = 0; i < rooms.length; i++) {
        const d = distToOutline(rooms[i].polygon, px0, py0)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      if (best < 0 || bestD > 40) continue
    }

    // Двери ставим в БОКОВЫЕ стены лестничного проёма — там, где к нему
    // примыкают помещения. Раньше они лежали на линии входа поперёк марша и
    // приходились ровно на верхнюю ступень: проём тогда был открыт сверху и
    // другого места не было. Теперь у него есть стены на всю высоту, и вход
    // на лестницу там, где и на чертеже — сбоку, из коридора.
    const host = out[best]
    const runVertical = treadHorizontal
    const put = []
    for (let k = 0; k < host.polygon.length; k++) {
      const A = host.polygon[k]
      const B = host.polygon[(k + 1) % host.polygon.length]
      // грань вдоль хода марша
      if (runVertical ? Math.abs(B[0] - A[0]) > 3 : Math.abs(B[1] - A[1]) > 3) continue
      if (Math.hypot(B[0] - A[0], B[1] - A[1]) < width) continue
      // с какой комнатой она общая и на каком участке
      for (let q = 0; q < out.length; q++) {
        if (q === best) continue
        for (let m = 0; m < out[q].polygon.length; m++) {
          const C = out[q].polygon[m]
          const D = out[q].polygon[(m + 1) % out[q].polygon.length]
          const sameLine = runVertical
            ? Math.abs(C[0] - A[0]) <= 3 && Math.abs(D[0] - A[0]) <= 3
            : Math.abs(C[1] - A[1]) <= 3 && Math.abs(D[1] - A[1]) <= 3
          if (!sameLine) continue
          const [p0, p1] = runVertical ? [A[1], B[1]] : [A[0], B[0]]
          const [q0, q1] = runVertical ? [C[1], D[1]] : [C[0], D[0]]
          const lo = Math.max(Math.min(p0, p1), Math.min(q0, q1))
          const hi = Math.min(Math.max(p0, p1), Math.max(q0, q1))
          if (hi - lo < width) continue
          const at = (lo + hi) / 2
          put.push(runVertical ? { x: A[0], y: at } : { x: at, y: A[1] })
        }
      }
    }
    // По ОДНОЙ двери на сторону — ближайшую ко входу на лестницу. Иначе на
    // каждой боковой стене их выходит по две: проём граничит и с коридором,
    // и с помещением ниже.
    const hb = bboxOf(host.polygon)
    const midX = hb.x + hb.w / 2
    const midY = hb.y + hb.h / 2
    const entry = runVertical ? ty(bTop) : tx(bTop)
    const bySide = new Map()
    for (const d of put) {
      const side = runVertical
        ? d.x < midX
          ? 'left'
          : 'right'
        : d.y < midY
          ? 'top'
          : 'bottom'
      const dist = Math.abs((runVertical ? d.y : d.x) - entry)
      const cur = bySide.get(side)
      if (!cur || dist < cur.dist) bySide.set(side, { ...d, side, dist })
    }
    for (const d of bySide.values()) {
      if (host.doors.some((o) => Math.hypot(o.x - d.x, o.y - d.y) < width)) continue
      host.doors.push({
        x: Math.round(d.x),
        y: Math.round(d.y),
        w: width,
        side: d.side,
        style: 'cross',
      })
    }
  }

  // Сантехника: приборы делают помещение санузлом, бачок унитаза — к стене.
  for (const item of v.details?.sanitary ?? []) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < rooms.length; i++) {
      // item.x/item.y — УЖЕ центр прибора (`classifyBlob` отдаёт середину).
      // Прибавка половины размера сдвигала точку, и ближайшей стеной выходила
      // не та: бачки унитазов смотрели вправо вместо верхней стены.
      if (!inside(v.rooms[i].polygon, item.x, item.y)) continue
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
    const cx = item.x
    const cy = item.y
    const dl = cx - sb.x
    const dr = sb.x + sb.w - cx
    const dt = cy - sb.y
    const db = sb.y + sb.h - cy
    const m = Math.min(dl, dr, dt, db)
    const tankDir = m === dl ? 'left' : m === dr ? 'right' : m === dt ? 'up' : 'down'
    // Придвигаем к стене ТОЛЬКО унитаз: у него бачок должен упираться в стену,
    // и по центру пятна чернил остаётся заметный зазор. Раковину не трогаем —
    // она и так встаёт по чертежу, а сдвиг её только портит.
    // Чашу унитаза рисуем чуть мельче найденного пятна: в пятно попадает и
    // обводка, и на плане овал выходит крупнее, чем нужно.
    const shrink = item.type === 'toilet' ? 0.85 : 1
    const fw = Math.max(10, Math.round(tw(item.w) * shrink))
    const fh = Math.max(10, Math.round(tw(item.h) * shrink))
    const box = out[best].rect ?? bboxOf(out[best].polygon)
    // сколько прибор занимает от своего центра в сторону стены
    const along = tankDir === 'up' || tankDir === 'down' ? fh / 2 : fw / 2
    // Насколько бачок вылезает за чашу — ровно как его рисует `Room.jsx`:
    // прямоугольник шириной `tankW` заезжает на овал на 1. Раньше тут стояла
    // ДРУГАЯ сторона бачка (длинная, 0.55 габарита), и унитаз отходил от стены
    // на лишние 5 единиц.
    const tank = item.type === 'toilet' ? Math.max(5, Math.round(Math.min(fw, fh) * 0.45)) - 1 : 0
    // Габарит комнаты идёт по ОСЕВОЙ линии стены, а стена рисуется толщиной 8
    // симметрично ей. Ставя бачок вплотную к габариту, мы сажали его внутрь
    // стены, и на плане он торчал наружу здания. Отступаем на половину стены
    // плюс зазор в единицу, чтобы бачок стоял у внутренней грани.
    const wallHalf = 4
    const gap = 1
    const reachOut = along + tank + wallHalf + gap
    let fx = tx(item.x)
    let fy = ty(item.y)
    if (item.type === 'toilet') {
      if (tankDir === 'up') fy = box.y + reachOut
      else if (tankDir === 'down') fy = box.y + box.h - reachOut
      else if (tankDir === 'left') fx = box.x + reachOut
      else fx = box.x + box.w - reachOut
    }
    out[best].features.push({
      type: item.type,
      x: Math.round(fx),
      y: Math.round(fy),
      w: fw,
      h: fh,
      // Унитазу нужен `tankDir` — куда бачок, то есть К стене. Раковине нужен
      // `dir` — куда выпуклость, то есть ОТ стены, плоской стороной к стене.
      // Раньше сюда шло `wallDir`, которого отрисовка не знает: все раковины
      // рисовались влево по умолчанию, спинами куда попало.
      tankDir,
      dir: { left: 'right', right: 'left', up: 'down', down: 'up' }[tankDir] ?? 'right',
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

  // Внутренние стены. Векторный движок их не отдавал вовсе: рисовалась тонкая
  // обводка полигона, и на фоне толстых наружных стен внутренние читались как
  // их отсутствие — особенно у лестницы. Общую грань двух комнат отдаём как
  // `partition`, отрисовка кладёт её толстой линией поверх заливок.
  {
    const near = (a, b) => Math.abs(a - b) <= 3
    const edges = out.map((r) =>
      r.polygon.map((p, k) => [p, r.polygon[(k + 1) % r.polygon.length]]),
    )
    for (let i = 0; i < out.length; i++) {
      for (const [a, b] of edges[i]) {
        const horizontal = near(a[1], b[1])
        const vertical = near(a[0], b[0])
        if (!horizontal && !vertical) continue
        // Грань внутренняя, если такая же есть у другой комнаты: наружные
        // стены рисует свой слой, дублировать их не нужно.
        const shared = edges.some((list, j) => {
          if (j === i) return false
          return list.some(([c, d]) => {
            if (horizontal ? !near(c[1], a[1]) || !near(d[1], a[1]) : !near(c[0], a[0]) || !near(d[0], a[0]))
              return false
            const [p0, p1] = horizontal ? [a[0], b[0]] : [a[1], b[1]]
            const [q0, q1] = horizontal ? [c[0], d[0]] : [c[1], d[1]]
            const lo = Math.max(Math.min(p0, p1), Math.min(q0, q1))
            const hi = Math.min(Math.max(p0, p1), Math.max(q0, q1))
            return hi - lo > 8
          })
        })
        if (!shared) continue
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 8) continue
        out[i].features.push({ type: 'partition', points: [a, b], strokeWidth: 7 })
      }
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
      // Марш вне контура — либо наружное крыльцо (оно примыкает к зданию),
      // либо штриховка на полях чертежа (она далеко). Отличаем по удалению:
      // крыльцо коттеджа лежит вплотную, а засечки БТИ — за десятки пикселей.
      // Раньше правило было «хоть одна ступень внутри контура», и стоило
      // контуру чуть сдвинуться, как крыльцо пропадало.
      const anyInside = f.treads.some(
        (t) =>
          inside(v.outline, (t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2) ||
          inside(v.outline, t.x1, t.y1) ||
          inside(v.outline, t.x2, t.y2)
      )
      if (!anyInside) {
        const tread =
          f.treads.reduce((a, t) => a + Math.hypot(t.x2 - t.x1, t.y2 - t.y1), 0) /
          f.treads.length
        let near = Infinity
        for (const t of f.treads) {
          const px = (t.x1 + t.x2) / 2
          const py = (t.y1 + t.y2) / 2
          for (let k = 0; k < v.outline.length; k++) {
            const [ax, ay] = v.outline[k]
            const [bx, by] = v.outline[(k + 1) % v.outline.length]
            const vx = bx - ax
            const vy = by - ay
            const l2 = vx * vx + vy * vy || 1
            let q = ((px - ax) * vx + (py - ay) * vy) / l2
            q = Math.max(0, Math.min(1, q))
            near = Math.min(near, Math.hypot(px - (ax + vx * q), py - (ay + vy * q)))
          }
        }
        if (near > tread * 1.5) continue
      }
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
      // Марш рисуем ровно на его настоящую длину. Раньше шаг поджимался снизу
      // до 8 единиц: при настоящих 5.4 и двадцати ступенях марш растягивался
      // со 102 единиц до 152 и вылезал за комнату, повисая в воздухе. Если
      // ступени встают слишком часто, чтобы их различить, — рисуем их реже,
      // но на той же длине.
      const spanPlan = tw(span)
      let count = f.count
      let step = spanPlan / Math.max(1, count - 1)
      const minStep = 5
      if (step < minStep) {
        count = Math.max(2, Math.floor(spanPlan / minStep) + 1)
        step = spanPlan / Math.max(1, count - 1)
      }
      // Марш бывает крупнее комнаты, к которой привязан: шахта на коттедже
      // разбита на несколько граней, и марш вылезал за свою на 26 единиц —
      // висел в воздухе. Обрезаем по комнате: лучше показать часть внутри,
      // чем целое снаружи.
      const box = rooms[host].rect
      // Поперёк — вписываем в ПРОСВЕТ комнаты на высоте марша, а не в её
      // габарит. Коридор на демо Г-образный: марш стоит в его отростке
      // шириной 50 единиц, а сам выходил 26 единиц шириной со смещением
      // вправо и торчал за отросток. Стенки отростка при этом рисуются,
      // и казалось, что у лестницы нет боковых стен.
      const midY = ty((y0 + Math.max(...ys)) / 2)
      const poly = rooms[host].polygon
      const cuts = []
      for (let k = 0; k < poly.length; k++) {
        const [ax, ay] = poly[k]
        const [bx, by] = poly[(k + 1) % poly.length]
        if (ay > midY === by > midY) continue
        cuts.push(ax + ((bx - ax) * (midY - ay)) / (by - ay))
      }
      cuts.sort((p, q) => p - q)
      let lane = null
      for (let k = 0; k + 1 < cuts.length; k += 2) {
        if (tx(x0) >= cuts[k] - 4 && tx(x0) <= cuts[k + 1] + 4)
          lane = { a: cuts[k], b: cuts[k + 1] }
      }
      // Начало марша — там, где начинается сам лестничный проход, а не там,
      // где нашлась первая ступень. Верхние ступени заходили в коридор выше
      // линии стены: боковых стен там нет, и марш висел в проходе.
      const laneAt = (yy) => {
        const cs = []
        for (let k = 0; k < poly.length; k++) {
          const [ax, ay] = poly[k]
          const [bx, by] = poly[(k + 1) % poly.length]
          if (ay > yy === by > yy) continue
          cs.push(ax + ((bx - ax) * (yy - ay)) / (by - ay))
        }
        cs.sort((p, q) => p - q)
        for (let k = 0; k + 1 < cs.length; k += 2)
          if (tx(x0) >= cs[k] - 4 && tx(x0) <= cs[k + 1] + 4) return cs[k + 1] - cs[k]
        return Infinity
      }
      const wide = (lane ? lane.b - lane.a : tw(len)) * 2.5
      let top = ty(y0)
      const bottom = top + (count - 1) * step
      while (count > 2 && laneAt(top + step * 0.5) > wide) {
        top += step
        count--
      }
      if (top < box.y) {
        const skip = Math.ceil((box.y - top) / step)
        top += skip * step
        count -= skip
      }
      while (count > 2 && top + (count - 1) * step > Math.min(box.y + box.h, bottom + step))
        count--
      if (count >= 2) {
        // ширину и положение марша подгоняем под просвет
        let sx = tx(x0)
        let slen = Math.max(16, tw(len))
        if (lane && lane.b - lane.a > 10) {
          slen = Math.max(16, Math.round((lane.b - lane.a) * 0.78))
          sx = Math.round((lane.a + lane.b) / 2 - slen / 2)
        }
        const entry = {
          type: 'stairs',
          x: sx,
          y: top,
          step,
          count,
          len: slen,
          dir: 'right',
        }
        out[host].features.push(entry)
      }
    } else {
      objects.push({ type: 'stairs', x: tx(cx), y: ty(cy), name: 'Наружная лестница' })
    }
  }

  // Палец в контуре: выступ, у которого выход и возврат идут почти вплотную.
  // На коттедже контур выходил с отростком 114×10 — на плане это читалось как
  // стена, торчащая из здания наружу. Форму здания это не описывает, а шум
  // обхода — да.
  const dropFingers = (poly, tol = 14) => {
    const res = poly.map(([x, y]) => [x, y])
    for (let pass = 0; pass < 2; pass++) {
      for (let i = res.length - 1; i >= 0 && res.length > 4; i--) {
        const a = res[i]
        const b = res[(i + 1) % res.length]
        const c = res[(i + 2) % res.length]
        const d = res[(i + 3) % res.length]
        // выход и возврат почти в одну точку, а сам выступ заметно длиннее
        if (Math.hypot(d[0] - a[0], d[1] - a[1]) > tol) continue
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < tol * 1.5) continue
        if (Math.hypot(c[0] - b[0], c[1] - b[1]) > tol) continue
        if (i + 3 <= res.length) res.splice(i + 1, 2)
      }
    }
    // После вырезания пальца остаются точки на одной прямой — убираем.
    const clean = []
    for (let i = 0; i < res.length; i++) {
      const p0 = res[(i + res.length - 1) % res.length]
      const p1 = res[i]
      const p2 = res[(i + 1) % res.length]
      const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
      const base = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) || 1
      if (Math.abs(cross) / base > 0.6) clean.push(p1)
    }
    return clean.length >= 3 ? clean : res
  }
  const outline =
    v.outline && v.outline.length >= 3
      ? dropFingers(v.outline.map(([x, y]) => [tx(x), ty(y)]))
      : undefined

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
