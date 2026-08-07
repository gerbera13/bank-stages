/**
 * SVG-превью OAS-Layout документов (oas/meridian-f*.layout.json → oas/*.svg).
 *
 * Правила oas-render:
 * - Y-up (OAS) → Y-down (SVG): инверсия на границе рендера, данные не меняются.
 * - Один масштаб для всего плана: SCALE = 2 px/мм.
 * - Слои/группы: oas-rooms, oas-walls, oas-openings, oas-furniture, oas-labels.
 * - Стены — линии с stroke-width = толщина × масштаб (стратегия «line»).
 * - Порядок отрисовки: заливки комнат → границы → стены → проёмы → мебель → подписи.
 * - Рендерер не выдумывает геометрию: всё рисуется только из сущностей OAS.
 *
 * Стиль: пастельная палитра (градиенты комнат как в bank-stages), тени feDropShadow
 * (пол здания, комнаты, мебель). Камеры — фиолетовые, банкоматы — зелёные.
 *
 * Двери: створка + дуга открывания. Направление открывания — внутрь помещения
 * (point-in-polygon по connects_rooms). Двойные двери (width ≥ 1600 мм) — две створки.
 * Окна — вырез + линия стекла; проходы (Passage Opening) — вырез с пунктиром.
 *
 * Запуск: node oas/render.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { globSync } from 'node:fs'

const SCALE = 2 // px на мм
const MARGIN = 400 // px отступ вокруг плана
const DOUBLE_DOOR_MM = 1600 // ширина, с которой дверь считается двустворчатой

// Пастельная палитра (usage → градиент «насыщенный верх → светлый низ»)
const USAGE_GRADIENT = {
  lobby: 'grad-room-lobby',
  cafe: 'grad-room-cafe',
  office: 'grad-room-office',
  meeting: 'grad-room-meeting',
  server_room: 'grad-room-server',
  sanitary: 'grad-room-sanitary',
  circulation: 'grad-room-corridor',
  storage: 'grad-room-storage',
}

const GRADIENTS = {
  'grad-room-lobby': ['#e0e7ff', '#eef2ff'],
  'grad-room-office': ['#e0f2fe', '#f0f9ff'],
  'grad-room-meeting': ['#fae8ff', '#fdf4ff'],
  'grad-room-server': ['#fde68a', '#fef3c7'],
  'grad-room-sanitary': ['#d1fae5', '#ecfdf5'],
  'grad-room-cafe': ['#fed7aa', '#fff7ed'],
  'grad-room-corridor': ['#e2e8f0', '#f1f5f9'],
  'grad-room-storage': ['#e7e5e4', '#f5f5f4'],
}

const WALL_COLOR = '#8496ab'
const DOOR_COLOR = '#94a3b8'

// --- Геометрия: OAS (Y-up, мм) → SVG (Y-down, px) ---
function makeProject(bounds) {
  const { xMin, yMin, xMax, yMax } = bounds
  return {
    x: (x) => (x - xMin) * SCALE + MARGIN,
    y: (y) => (yMax - y) * SCALE + MARGIN,
  }
}

function boundsOf(doc) {
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  const acc = (p) => {
    xMin = Math.min(xMin, p.x)
    yMin = Math.min(yMin, p.y)
    xMax = Math.max(xMax, p.x)
    yMax = Math.max(yMax, p.y)
  }
  for (const r of doc.rooms) r.boundary_polygon.points.forEach(acc)
  for (const s of doc.floor_slabs ?? []) s.boundary_polygon.points.forEach(acc)
  for (const w of doc.walls) [w.from, w.to].forEach(acc)
  return { xMin, yMin, xMax, yMax }
}

const polyPoints = (polygon, proj) =>
  polygon.points.map((p) => `${proj.x(p.x)},${proj.y(p.y)}`).join(' ')

// Центроид полигона (средневзвешенный по площади — корректен и для вогнутых).
function centroid(polygon) {
  const pts = polygon.points
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i]
    const p2 = pts[(i + 1) % pts.length]
    const cross = p1.x * p2.y - p2.x * p1.y
    a += cross
    cx += (p1.x + p2.x) * cross
    cy += (p1.y + p2.y) * cross
  }
  a /= 2
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

// Точка внутри полигона (ray casting, координаты SVG/px).
function pointInPolygon(px, py, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function defs() {
  const filters = [
    `<filter id="filter-floor-shadow" x="-20%" y="-20%" width="140%" height="160%">` +
      `<feDropShadow dx="0" dy="24" stdDeviation="36" floodColor="#0f172a" floodOpacity="0.3"/></filter>`,
    `<filter id="filter-room-shadow" x="-15%" y="-15%" width="130%" height="145%">` +
      `<feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#0f172a" floodOpacity="0.22"/></filter>`,
    `<filter id="filter-furn-shadow" x="-40%" y="-40%" width="180%" height="180%">` +
      `<feDropShadow dx="3" dy="5" stdDeviation="7" floodColor="#0f172a" floodOpacity="0.3"/></filter>`,
  ]
  const radial = `<radialGradient id="grad-floor" cx="50%" cy="42%" r="75%">` +
    `<stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#e8ecf4"/></radialGradient>`
  const lin = Object.entries(GRADIENTS)
    .map(([id, [top, bottom]]) => {
      const name = id.replace('grad-room-', '')
      return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="${top}"/><stop offset="100%" stop-color="${bottom}"/></linearGradient>`
    })
    .join('')
  return `<defs>${filters.join('')}${radial}${lin}</defs>`
}

function renderSlab(doc, proj) {
  return (doc.floor_slabs ?? [])
    .map(
      (s) =>
        `<polygon points="${polyPoints(s.boundary_polygon, proj)}" fill="url(#grad-floor)" filter="url(#filter-floor-shadow)"/>`
    )
    .join('')
}

function renderRoomFills(doc, proj) {
  return doc.rooms
    .map(
      (r) =>
        `<polygon points="${polyPoints(r.boundary_polygon, proj)}" fill="url(#${USAGE_GRADIENT[r.usage] ?? 'grad-room-corridor'})" filter="url(#filter-room-shadow)" stroke="#cbd5e1" stroke-width="1.5"/>`
    )
    .join('')
}

function renderWalls(doc, proj) {
  return doc.walls
    .map(
      (w) =>
        `<line x1="${proj.x(w.from.x)}" y1="${proj.y(w.from.y)}" x2="${proj.x(w.to.x)}" y2="${proj.y(w.to.y)}" stroke="${WALL_COLOR}" stroke-width="${w.thickness_mm * SCALE}" stroke-linecap="butt"/>`
    )
    .join('')
}

const wallLen = (w) => Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y)

// Точки четверти окружности: центр center, от from до to (по стороне sideUnit), радиус r.
function quarterArc(center, from, to, r, sideUnit, steps = 24) {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x)
  const a1 = Math.atan2(to.y - center.y, to.x - center.x)
  const mid1 = [Math.cos(a0 + Math.PI / 4), Math.sin(a0 + Math.PI / 4)]
  const mid2 = [Math.cos(a0 - Math.PI / 4), Math.sin(a0 - Math.PI / 4)]
  const delta = mid1[0] * sideUnit[0] + mid1[1] * sideUnit[1] > 0 ? Math.PI / 2 : -Math.PI / 2
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (delta * i) / steps
    pts.push(`${center.x + Math.cos(a) * r},${center.y + Math.sin(a) * r}`)
  }
  return `M ${pts.join(' L ')}`
}

function renderOpenings(doc, proj, wallsById, roomPtsById) {
  const parts = []
  const doorStyle = ` stroke="${DOOR_COLOR}" stroke-width="6" fill="none" stroke-linecap="round"`
  for (const o of doc.openings) {
    const w = wallsById.get(o.in_wall)
    if (!w) continue
    const len = wallLen(w)
    const ux = (w.to.x - w.from.x) / len
    const uy = (w.to.y - w.from.y) / len
    const sx = w.from.x + ux * o.position_along_wall_mm
    const sy = w.from.y + uy * o.position_along_wall_mm
    const ex = w.from.x + ux * (o.position_along_wall_mm + o.width_mm)
    const ey = w.from.y + uy * (o.position_along_wall_mm + o.width_mm)
    const S = { x: proj.x(sx), y: proj.y(sy) }
    const E = { x: proj.x(ex), y: proj.y(ey) }
    const thick = w.thickness_mm * SCALE
    const wPx = Math.hypot(E.x - S.x, E.y - S.y)
    // Направление стены и перпендикуляр в SVG-координатах.
    const U = { x: (E.x - S.x) / wPx, y: (E.y - S.y) / wPx }
    const N = { x: -U.y, y: U.x }

    // Сторона открывания: внутрь одной из комнат из connects_rooms.
    let side = N
    const mid = { x: (S.x + E.x) / 2, y: (S.y + E.y) / 2 }
    for (const rid of o.connects_rooms ?? []) {
      const pts = roomPtsById.get(rid)
      if (!pts) continue
      if (pointInPolygon(mid.x + N.x * 60, mid.y + N.y * 60, pts)) {
        side = N
        break
      }
      if (pointInPolygon(mid.x - N.x * 60, mid.y - N.y * 60, pts)) {
        side = { x: -N.x, y: -N.y }
        break
      }
    }

    // Проём: белый вырез в стене.
    const gap = `<rect x="${Math.min(S.x, E.x)}" y="${Math.min(S.y, E.y)}" width="${Math.abs(E.x - S.x) || thick}" height="${Math.abs(E.y - S.y) || thick}" fill="#ffffff"/>`

    if (o.opening_type === 'window') {
      // Окно: вырез + линия стекла по центру проёма.
      const glass = `<line x1="${S.x}" y1="${S.y}" x2="${E.x}" y2="${E.y}" stroke="#7dd3fc" stroke-width="${Math.max(6, thick * 0.18)}"/>`
      parts.push(`<g>${gap}${glass}</g>`)
    } else if (o.operation === 'swing' && o.width_mm >= DOUBLE_DOOR_MM) {
      // Двойная распашная дверь: две створки в разные стороны от центра.
      const half = wPx / 2
      const M = { x: (S.x + E.x) / 2, y: (S.y + E.y) / 2 }
      const t1 = { x: S.x + side.x * half, y: S.y + side.y * half }
      const t2 = { x: E.x + side.x * half, y: E.y + side.y * half }
      const arc1 = quarterArc(S, M, t1, half, side)
      const arc2 = quarterArc(E, M, t2, half, side)
      parts.push(
        `<g>${gap}` +
          `<path d="${arc1}"${doorStyle}/>` +
          `<path d="${arc2}"${doorStyle}/>` +
          `<line x1="${S.x}" y1="${S.y}" x2="${t1.x}" y2="${t1.y}"${doorStyle}/>` +
          `<line x1="${E.x}" y1="${E.y}" x2="${t2.x}" y2="${t2.y}"${doorStyle}/></g>`
      )
    } else if (o.operation === 'swing') {
      // Одностворчатая дверь: петля у начала проёма, створка открывается в комнату.
      const tip = { x: S.x + side.x * wPx, y: S.y + side.y * wPx }
      const arc = quarterArc(S, E, tip, wPx, side)
      parts.push(
        `<g>${gap}<path d="${arc}"${doorStyle}/><line x1="${S.x}" y1="${S.y}" x2="${tip.x}" y2="${tip.y}"${doorStyle}/></g>`
      )
    } else {
      // Проход (Passage Opening): вырез с пунктирной рамкой.
      parts.push(
        `<g>${gap}<rect x="${Math.min(S.x, E.x)}" y="${Math.min(S.y, E.y)}" width="${Math.abs(E.x - S.x) || thick}" height="${Math.abs(E.y - S.y) || thick}" fill="none" stroke="#94a3b8" stroke-width="4" stroke-dasharray="14 10"/></g>`
      )
    }
  }
  return parts.join('')
}

function renderFurniture(doc, proj) {
  const parts = []
  const shadow = ' filter="url(#filter-furn-shadow)"'
  const rect = (x, y, w, h, fill, stroke) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke ?? fill}" stroke-width="2"/>`
  for (const f of doc.furniture) {
    if (f.footprint) {
      parts.push(
        `<polygon points="${polyPoints(f.footprint, proj)}" fill="#cbd5e1" stroke="#94a3b8" stroke-width="2"${shadow}/>`
      )
      continue
    }
    if (!f.position) continue
    const cx = proj.x(f.position.x)
    const cy = proj.y(f.position.y)
    const d = f.dimensions ?? {}
    const w = (d.width_mm ?? 400) * SCALE
    const h = (d.depth_mm ?? w) * SCALE
    switch (f.type_name) {
      case 'Table':
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="#f5f5f4" stroke="#d6d3d1"${shadow}/>`)
        break
      case 'Chair':
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="#fafaf9" stroke="#e4e4e7"${shadow}/>`)
        break
      case 'Elevator':
        parts.push(`<g${shadow}>${rect(cx - w / 2, cy - h / 2, w, h, '#cbd5e1', '#94a3b8')}`)
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${w / 6}" fill="#f8fafc"/></g>`)
        break
      case 'Staircase':
        parts.push(`<g${shadow}>${rect(cx - w / 2, cy - h / 2, w, h, '#e2e8f0', '#cbd5e1')}`)
        for (let i = -1; i <= 1; i++) {
          parts.push(
            `<line x1="${cx + i * (w / 4)}" y1="${cy + h / 3}" x2="${cx + i * (w / 4) + w / 4}" y2="${cy - h / 3}" stroke="#ffffff" stroke-width="6"/>`
          )
        }
        parts.push('</g>')
        break
      case 'ATM':
        // Банкомат — пастельно-зелёный.
        parts.push(`<g${shadow}>${rect(cx - w / 2, cy - h / 2, w, h, '#a7f3d0', '#059669')}`)
        parts.push(`<rect x="${cx - w / 4}" y="${cy - h / 4}" width="${w / 2}" height="${h / 6}" rx="6" fill="#ecfdf5"/></g>`)
        break
      case 'CCTV Camera': {
        // Видеокамера — пастельно-фиолетовая.
        parts.push(`<g${shadow}>`)
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="#d8b4fe" stroke="#a855f7"/>`)
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${w / 6}" fill="#f3e8ff"/>`)
        // Направление взгляда: 0° = +Y (вверх), по часовой стрелке — конвенция OAS.
        const rad = ((f.rotation_deg ?? 0) * Math.PI) / 180
        parts.push(
          `<line x1="${cx}" y1="${cy}" x2="${cx + Math.sin(rad) * w * 1.4}" y2="${cy - Math.cos(rad) * w * 1.4}" stroke="#a855f7" stroke-width="4"/>`
        )
        parts.push('</g>')
        break
      }
      default:
        parts.push(rect(cx - w / 2, cy - h / 2, w, h, '#cbd5e1', '#94a3b8'))
    }
  }
  return parts.join('')
}

function renderLabels(doc, proj) {
  const parts = []
  for (const r of doc.rooms) {
    if (!r.name) continue
    const c = centroid(r.boundary_polygon)
    const size = Math.max(36, Math.min(96, Math.sqrt(r.area_m2) * 12))
    const x = proj.x(c.x)
    const y = proj.y(c.y)
    parts.push(
      `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${size}" font-weight="600" fill="#334155">${r.name}</text>` +
        `<text x="${x}" y="${y + size * 0.75}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${size * 0.52}" fill="#94a3b8">${r.area_m2.toFixed(1)} м²</text>`
    )
  }
  return parts.join('')
}

function renderScaleBar(W, H) {
  const len = 2000 * SCALE // 2 м
  const x = W - MARGIN - len - 300
  const y = H - MARGIN - 300
  return (
    `<g id="oas-annotations">` +
    `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y}" stroke="#64748b" stroke-width="6"/>` +
    `<line x1="${x}" y1="${y - 40}" x2="${x}" y2="${y + 40}" stroke="#64748b" stroke-width="6"/>` +
    `<line x1="${x + len}" y1="${y - 40}" x2="${x + len}" y2="${y + 40}" stroke="#64748b" stroke-width="6"/>` +
    `<text x="${x + len / 2}" y="${y + 90}" text-anchor="middle" font-size="48" fill="#64748b">2 м</text>` +
    `</g>`
  )
}

function renderDoc(doc) {
  const bounds = boundsOf(doc)
  const proj = makeProject(bounds)
  const wallsById = new Map(doc.walls.map((w) => [w.id, w]))
  const roomPtsById = new Map(
    doc.rooms.map((r) => [r.id, r.boundary_polygon.points.map((p) => [proj.x(p.x), proj.y(p.y)])])
  )
  const W = (bounds.xMax - bounds.xMin) * SCALE + MARGIN * 2
  const H = (bounds.yMax - bounds.yMin) * SCALE + MARGIN * 2
  const level = doc.levels?.[0]
  const title = `${doc.plan_id} — ${level?.name ?? ''} (${level?.elevation_mm ?? 0} мм)`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">
${defs()}
<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
<g id="oas-rooms">${renderSlab(doc, proj)}${renderRoomFills(doc, proj)}</g>
<g id="oas-walls">${renderWalls(doc, proj)}</g>
<g id="oas-openings">${renderOpenings(doc, proj, wallsById, roomPtsById)}</g>
<g id="oas-furniture">${renderFurniture(doc, proj)}</g>
<g id="oas-labels">${renderLabels(doc, proj)}</g>
${renderScaleBar(W, H)}
<text x="${MARGIN}" y="${MARGIN - 80}" font-size="56" font-weight="600" fill="#1e293b">${title}</text>
</svg>
`
}

const files = globSync('meridian-*.layout.json', { cwd: import.meta.dirname })
for (const f of files) {
  const doc = JSON.parse(readFileSync(join(import.meta.dirname, f), 'utf8'))
  const out = join(import.meta.dirname, f.replace('.layout.json', '.svg'))
  writeFileSync(out, renderDoc(doc))
  console.log(`OK ${out}`)
}
console.log(`Готово: ${files.length} SVG`)
