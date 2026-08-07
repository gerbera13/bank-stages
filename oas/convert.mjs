/**
 * Генератор OAS-Layout документов из мок-данных src/data/building.js.
 *
 * Запуск: node oas/convert.mjs
 *
 * Преобразования:
 * - Y-down (SVG) → Y-up (OAS): y' = (640 - y) * SCALE
 * - Масштаб: 1 SVG-ед = 20 мм (SCALE = 20) — даёт реалистичные размеры:
 *   дверь 50 ед → 1000 мм, стена 8 ед → 160 мм, коридор 120 ед → 2400 мм.
 * - Комнаты → rooms с boundary_polygon (замкнутый, CCW) и area_m2 (shoeсlase).
 * - Стены строятся из общих рёбер комнат: рёбра режутся по всем точкам
 *   пересечения (концы рёбер + границы проёмов), соседние фрагменты с одинаковым
 *   набором комнат сливаются в один «прогон» (run) = одна стена.
 * - doors/windows/wallGaps/partition.doorGap → проёмы (openings), пробивающие стены;
 *   position_along_wall_mm считается от начала стены (run).
 * - Проходы wallGap → opening "door" с type_name "Passage Opening" (operation fixed),
 *   полностью перекрывающий свой фрагмент стены.
 * - features (столики, стулья, стойки, ширмы) → furniture; objects (лифт, лестница,
 *   банкомат, камера) → furniture (type fixture).
 * - Декоративные элементы (tileCircle/tilePatch) в OAS не переносятся — см. README.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { building } from '../src/data/building.js'

const OUT_DIR = join(import.meta.dirname, '.')
const SCALE = 20
const SVG_HEIGHT = 640
const ELEVATION_MM = { f1: 0, f2: 3600, f3: 7200 }
const WALL_THICKNESS = 8 * SCALE
const PARTITION_THICKNESS = 3 * SCALE
const WALL_HEIGHT = 3200
const PARTITION_HEIGHT = 2600
const DOOR_HEIGHT = 2100
const WINDOW_HEIGHT = 1500
const WINDOW_SILL = 900

const pt = ([x, y]) => ({ x: x * SCALE, y: (SVG_HEIGHT - y) * SCALE })
const dist = (a, b) => {
  const ax = Array.isArray(a) ? a[0] : a.x
  const ay = Array.isArray(a) ? a[1] : a.y
  const bx = Array.isArray(b) ? b[0] : b.x
  const by = Array.isArray(b) ? b[1] : b.y
  return Math.hypot(bx - ax, by - ay)
}
const onSeg = ([px, py], [x1, y1], [x2, y2], eps = 0.5) =>
  Math.abs(dist([px, py], [x1, y1]) + dist([px, py], [x2, y2]) - dist([x1, y1], [x2, y2])) < eps

function signedArea(pts) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const ax = Array.isArray(a) ? a[0] : a.x
    const ay = Array.isArray(a) ? a[1] : a.y
    const bx = Array.isArray(b) ? b[0] : b.x
    const by = Array.isArray(b) ? b[1] : b.y
    s += ax * by - bx * ay
  }
  return s / 2
}

function toPolygon(pts) {
  let p = pts.map(pt)
  if (signedArea(p) < 0) p = p.reverse()
  return { unit: 'mm', closed: true, points: p }
}

const areaM2 = (pts) => Math.round((Math.abs(signedArea(pts.map(pt))) / 1e6) * 100) / 100

const usageOf = (room) => {
  switch (room.type) {
    case 'corridor':
      return 'circulation'
    case 'server':
      return 'server_room'
    case 'hall':
      return 'lobby'
    case 'cafe':
      return 'cafe'
    case 'office':
      return 'office'
    case 'meeting':
      return 'meeting'
    case 'service':
      if (room.name === 'М' || room.name === 'Ж') return 'sanitary'
      if (room.name) return 'storage'
      return 'circulation'
    default:
      return room.type
  }
}

const FEATURE_FURNITURE = {
  table: { type: 'furniture', type_name: 'Table', height: 750 },
  chair: { type: 'furniture', type_name: 'Chair', w: 450, h: 450 },
  bench: { type: 'furniture', type_name: 'Bench', height: 450, footprint: true },
  counter: { type: 'casework', type_name: 'Counter', height: 1050, footprint: true },
  counterCurve: { type: 'casework', type_name: 'Counter', height: 1050, footprint: true },
  screen: { type: 'fixture', type_name: 'Divider Screen', height: 1500, footprint: true },
}

const OBJECT_FURNITURE = {
  elevator: { type: 'fixture', type_name: 'Elevator', w: 1400, d: 1400, h: 2400 },
  stairs: { type: 'fixture', type_name: 'Staircase', w: 1400, d: 1400, h: 3600 },
  atm: { type: 'fixture', type_name: 'ATM', w: 800, d: 600, h: 1500 },
  camera: { type: 'fixture', type_name: 'CCTV Camera', w: 250, d: 250, h: 250 },
}

function convertFloor(floor) {
  const fid = floor.id
  const levelId = `level_${fid}`
  const errors = []

  // --- 1. Сегменты (рёбра комнат + перегородки) и проёмы ---
  const segs = [] // { a:[x,y], b:[x,y], roomId, partition }
  const openings = [] // { kind, roomId, lineKey, start, end, extra }

  const addOpening = (op) => openings.push(op)

  for (const room of floor.rooms) {
    const poly = room.polygon
    if (poly.length < 3) errors.push(`${room.id}: полигон < 3 точек`)
    for (let i = 0; i < poly.length; i++) {
      segs.push({ a: poly[i], b: poly[(i + 1) % poly.length], roomId: room.id, partition: false })
    }
    for (const d of room.doors ?? []) {
      addOpening({ kind: 'door', roomId: room.id, center: [d.x, d.y], w: d.w })
    }
    for (const w of room.windows ?? []) {
      addOpening({ kind: 'window', roomId: room.id, center: [w.x, w.y], w: w.w })
    }
    for (const g of room.wallGaps ?? []) {
      addOpening({ kind: 'passage', roomId: room.id, from: [g.x1, g.y1], to: [g.x2, g.y2] })
    }
    for (const feat of room.features ?? []) {
      if (feat.type !== 'partition') continue
      const pts = feat.points ?? []
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({ a: pts[i], b: pts[i + 1], roomId: room.id, partition: true })
      }
      if (feat.doorGap) {
        addOpening({ kind: 'passage', roomId: room.id, from: [feat.doorGap[0], feat.doorGap[1]], to: [feat.doorGap[2], feat.doorGap[3]] })
      }
    }
  }

  // --- 2. Разметка проёмов по рёбрам (координаты start/end вдоль оси) ---
  const lineKeyOf = ([x1, y1], [x2, y2]) =>
    Math.abs(y1 - y2) < 1e-9 ? `h:${y1}` : `v:${x1}`

  // Решётка «линия → набор значений разреза»: концы сегментов на линии + границы проёмов.
  const cutLines = new Map()
  const addCut = (key, v) => {
    if (!cutLines.has(key)) cutLines.set(key, new Set())
    cutLines.get(key).add(Math.round(v * 10) / 10)
  }
  for (const s of segs) addCut(lineKeyOf(s.a, s.b), s.a[0] === s.b[0] ? s.a[1] : s.a[0])

  const edgeOf = (roomId, center) => {
    const room = floor.rooms.find((r) => r.id === roomId)
    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i]
      const b = room.polygon[(i + 1) % room.polygon.length]
      if (onSeg(center, a, b)) return { a, b, key: lineKeyOf(a, b) }
    }
    return null
  }

  for (const op of openings) {
    if (op.kind === 'passage') {
      const key = lineKeyOf(op.from, op.to)
      const c = op.from[0] === op.to[0] ? op.from[0] : op.from[1]
      const axis = c === op.from[0] ? 1 : 0
      op.lineKey = key
      op.start = Math.min(op.from[axis], op.to[axis])
      op.end = Math.max(op.from[axis], op.to[axis])
      addCut(key, op.start)
      addCut(key, op.end)
    } else {
      const e = edgeOf(op.roomId, op.center)
      if (!e) {
        errors.push(`${op.roomId}: ${op.kind} (${op.center}) не лежит на ребре`)
        continue
      }
      const axis = e.a[0] === e.b[0] ? 1 : 0
      const lo = Math.min(e.a[axis], e.b[axis])
      const hi = Math.max(e.a[axis], e.b[axis])
      const c = op.center[axis]
      op.lineKey = e.key
      op.start = Math.max(lo, c - op.w / 2)
      op.end = Math.min(hi, c + op.w / 2)
      addCut(e.key, op.start)
      addCut(e.key, op.end)
    }
  }

  // --- 3. Фрагменты (атомарные куски рёбер) ---
  const pieces = new Map() // key → { start, end, axis, c, rooms:Set, partition:Set, cover:op }
  const pieceKey = (axis, c, s, e) => `${axis}:${c}:${s}:${e}`

  for (const s of segs) {
    const axis = s.a[0] === s.b[0] ? 1 : 0
    const c = s.a[1 - axis]
    const lo = Math.min(s.a[axis], s.b[axis])
    const hi = Math.max(s.a[axis], s.b[axis])
    const cuts = [...cutLines.get(lineKeyOf(s.a, s.b))].filter((v) => v > lo && v < hi).sort((x, y) => x - y)
    const all = [lo, ...cuts, hi]
    for (let i = 0; i < all.length - 1; i++) {
      const start = all[i]
      const end = all[i + 1]
      if (end - start < 1e-9) continue
      const key = pieceKey(axis, c, start, end)
      let p = pieces.get(key)
      if (!p) {
        p = { start, end, axis, c, rooms: new Set(), partitions: new Set() }
        pieces.set(key, p)
      }
      p.rooms.add(s.roomId)
      if (s.partition) p.partitions.add(s.roomId)
    }
  }

  // --- 4. Покрытие фрагментов проёмами + прогоны стен ---
  for (const p of pieces.values()) {
    for (const op of openings) {
      if (op.lineKey !== `${p.axis === 1 ? 'v' : 'h'}:${p.c}`) continue
      if (op.start <= p.start + 1e-9 && op.end >= p.end - 1e-9) {
        p.cover = op
        break
      }
    }
  }

  const sorted = [...pieces.values()].sort((x, y) =>
    x.axis === y.axis ? x.c - y.c || x.start - y.start : x.c - y.c
  )
  const byLine = new Map()
  for (const p of sorted) {
    const key = `${p.axis}:${p.c}`
    if (!byLine.has(key)) byLine.set(key, [])
    byLine.get(key).push(p)
  }

  const runs = [] // { from, to, rooms:Set, partitions:Set, pieces:[] }
  for (const linePieces of byLine.values()) {
    let cur = null
    for (const p of linePieces) {
      const roomsKey = [...p.rooms].sort().join('|')
      const partKey = p.partitions.size > 0 ? 'p' : 'w'
      const key = `${roomsKey}|${partKey}`
      if (cur && cur.key === key && Math.abs(p.start - cur.end) < 1e-9) {
        cur.end = p.end
        cur.pieces.push(p)
      } else {
        cur = { key, axis: p.axis, c: p.c, start: p.start, end: p.end, rooms: p.rooms, partitions: p.partitions, pieces: [p] }
        runs.push(cur)
      }
    }
  }

  // --- 5. Стены ---
  const walls = []
  const wallById = new Map()
  let wn = 0
  for (const r of runs) {
    const axis = r.axis
    const a = axis === 1 ? [r.c, r.start] : [r.start, r.c]
    const b = axis === 1 ? [r.c, r.end] : [r.end, r.c]
    const id = `${fid}_w${String(++wn).padStart(3, '0')}`
    const wall = {
      id,
      from: pt(a),
      to: pt(b),
      thickness_mm: r.partitions.size ? PARTITION_THICKNESS : WALL_THICKNESS,
      wall_height_mm: r.partitions.size ? PARTITION_HEIGHT : WALL_HEIGHT,
      level: levelId,
      adjacent_rooms: [...r.rooms].sort(),
      type_name: 'IfcWall',
    }
    walls.push(wall)
    wallById.set(id, { run: r, length: dist(pt(a), pt(b)) })
    r.wallId = id
  }

  // --- 6. Проёмы ---
  const openingList = []
  const connections = []
  let on = 0
  for (const op of openings) {
    const lineKey = op.lineKey
    if (!lineKey) continue
    const axis = lineKey.startsWith('v') ? 1 : 0
    const c = Number(lineKey.slice(2))
    // Прогон с наибольшим пересечением (проём может задевать угол комнаты,
    // где пересекается два прогона) — проём обрезается к границам прогона.
    let run = null
    let overlap = -1
    for (const r of runs) {
      if (r.axis !== axis || r.c !== c) continue
      const ov = Math.min(op.end, r.end) - Math.max(op.start, r.start)
      if (ov > overlap) {
        overlap = ov
        run = r
      }
    }
    if (!run || overlap <= 0) {
      errors.push(`${op.roomId}: проём ${op.start}-${op.end} не попал ни в одну стену`)
      continue
    }
    const clipStart = Math.max(op.start, run.start)
    const clipEnd = Math.min(op.end, run.end)
    const wallLen = dist(run.axis === 1 ? [run.c, run.start] : [run.start, run.c], run.axis === 1 ? [run.c, run.end] : [run.end, run.c]) * SCALE
    const position = (clipStart - run.start) * SCALE
    const width = (clipEnd - clipStart) * SCALE
    if (position < 0 || position + width > wallLen + 1e-6) {
      errors.push(`${op.roomId}: проём выходит за стену (pos=${position}, w=${width}, len=${wallLen})`)
    }
    const rooms = [...run.rooms].sort()
    const isPartition = run.partitions.size > 0
    const connects = rooms.length > 1 ? rooms : isPartition ? [rooms[0]] : [rooms[0], 'exterior']
    const id = `${fid}_o${String(++on).padStart(3, '0')}`
    const opening = {
      id,
      opening_type: op.kind === 'window' ? 'window' : 'door',
      in_wall: run.wallId,
      position_along_wall_mm: Math.round(position),
      width_mm: Math.round(width),
      height_mm: op.kind === 'window' ? WINDOW_HEIGHT : DOOR_HEIGHT,
      connects_rooms: connects,
      level: levelId,
    }
    if (op.kind === 'window') {
      opening.sill_height_mm = WINDOW_SILL
      opening.is_fixed = true
      opening.operation = 'fixed'
      opening.type_name = 'IfcWindow'
    } else if (op.kind === 'passage') {
      opening.type_name = 'Passage Opening'
      opening.is_fixed = true
      opening.operation = 'fixed'
    } else {
      opening.operation = 'swing'
      opening.type_name = 'IfcDoor'
    }
    openingList.push(opening)
    if (opening.opening_type === 'door' && connects.length === 2 && connects[1] !== 'exterior') {
      connections.push({ from: connects[0], to: connects[1], type: 'direct' })
    }
  }

  // --- 7. Комнаты ---
  const rooms = floor.rooms.map((room) => {
    const r = {
      id: room.id,
      usage: usageOf(room),
      boundary_polygon: toPolygon(room.polygon),
      area_m2: areaM2(room.polygon),
      level: levelId,
    }
    if (room.name) r.name = room.name
    if (room.windows?.length) r.tags = ['daylit']
    return r
  })

  // --- 8. Мебель (features) ---
  const furniture = []
  let fn = 0
  for (const room of floor.rooms) {
    for (const feat of room.features ?? []) {
      const spec = FEATURE_FURNITURE[feat.type]
      if (!spec) continue
      const id = `${fid}_furn${String(++fn).padStart(3, '0')}`
      const f = { id, type: spec.type, type_name: spec.type_name, in_room: room.id, level: levelId }
      if (spec.footprint) {
        f.footprint = toPolygon(feat.points)
        const xs = feat.points.map((p) => p[0])
        const ys = feat.points.map((p) => p[1])
        f.dimensions = { width_mm: (Math.max(...xs) - Math.min(...xs)) * SCALE, depth_mm: (Math.max(...ys) - Math.min(...ys)) * SCALE, height_mm: spec.height }
      } else {
        f.position = pt([feat.x ?? 0, feat.y ?? 0])
        if (spec.w) {
          f.dimensions = { width_mm: spec.w, depth_mm: spec.w, height_mm: spec.h }
        } else {
          f.dimensions = { width_mm: (feat.r ?? 10) * 2 * SCALE, depth_mm: (feat.r ?? 10) * 2 * SCALE, height_mm: spec.height }
        }
      }
      furniture.push(f)
    }
  }

  // --- 9. Мебель (objects: лифты, лестницы, банкоматы, камеры) ---
  for (const obj of floor.objects ?? []) {
    const spec = OBJECT_FURNITURE[obj.type]
    if (!spec) continue
    const f = {
      id: obj.id,
      position: pt([obj.x, obj.y]),
      rotation_deg: obj.type === 'camera' ? obj.details.direction : 0,
      dimensions: { width_mm: spec.w, depth_mm: spec.d, height_mm: spec.h },
      type: spec.type,
      type_name: spec.type_name,
      in_room: obj.roomId,
      level: levelId,
      tags: [obj.status],
    }
    furniture.push(f)
  }

  // --- 10. Уровень и плита ---
  const level = {
    id: levelId,
    name: floor.name,
    elevation_mm: ELEVATION_MM[fid] ?? 0,
    is_building_story: true,
  }
  const slab = {
    id: `slab_${fid}`,
    boundary_polygon: toPolygon(floor.outline),
    level: levelId,
    height_above_level_mm: 0,
    type_name: 'Reinforced Concrete Slab',
  }

  // --- 11. Документ ---
  const doc = {
    oas: '1.0.0',
    plan_id: `meridian-${fid}`,
    units: { length: 'mm', angle: 'deg' },
    levels: [level],
    rooms,
    walls,
    openings: openingList,
    floor_slabs: [slab],
    furniture,
    connections,
    metadata: {
      generated_by: 'oas/convert.mjs (bank-stages)',
      timestamp: new Date().toISOString(),
      notes: [
        `Источник: src/data/building.js, этаж ${floor.name}.`,
        `Масштаб: 1 SVG-ед = ${SCALE} мм; координаты инвертированы Y-down → Y-up.`,
        `Толщина стен ${WALL_THICKNESS} мм = strokeWidth 8; перегородки ${PARTITION_THICKNESS} мм = strokeWidth 3.`,
        `Уровни: перепад этажей принят 3600 мм (elevation_mm).`,
        'Проходы wallGap смоделированы как openings "Passage Opening" (is_fixed, operation fixed).',
        'Декоративные элементы (tileCircle, tilePatch) не переносятся в OAS.',
        'Операционные данные (ip, cash, lastService и т.п.) не входят в OAS — см. oas/README.md.',
        'rotation_deg камер = азимут взгляда: 0° = +Y, положительное направление по часовой стрелке от +Y.',
      ],
    },
  }

  return { doc, errors }
}

// --- Вывод ---
const fileNames = []
let allErrors = 0
for (const floor of building.floors) {
  const { doc, errors } = convertFloor(floor)
  const file = join(OUT_DIR, `${doc.plan_id}.layout.json`)
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  fileNames.push(file)
  allErrors += errors.length
  if (errors.length) console.error(`[${doc.plan_id}] ${errors.length} ошибок:\n` + errors.join('\n'))
  else console.log(`OK ${doc.plan_id}: ${doc.rooms.length} комнат, ${doc.walls.length} стен, ${doc.openings.length} проёмов, ${doc.furniture.length} мебели`)
}

// --- Валидация ---
for (const file of fileNames) {
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const wallsById = new Map(doc.walls.map((w) => [w.id, w]))
  for (const o of doc.openings) {
    const w = wallsById.get(o.in_wall)
    if (!w) throw new Error(`${file}: ${o.id} → нет стены ${o.in_wall}`)
    const len = dist([w.from.x, w.from.y], [w.to.x, w.to.y])
    if (o.position_along_wall_mm < 0 || o.position_along_wall_mm + o.width_mm > len + 1) {
      throw new Error(`${file}: ${o.id} выходит за пределы стены ${o.in_wall}`)
    }
  }
  for (const r of doc.rooms) {
    if (r.boundary_polygon.points.some((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y))) {
      throw new Error(`${file}: ${r.id} — нецелые координаты`)
    }
  }
}
console.log(`Создано файлов: ${fileNames.length}`)
process.exit(allErrors ? 1 : 0)
