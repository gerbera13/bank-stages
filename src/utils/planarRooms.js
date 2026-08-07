/**
 * Планарное разбиение: отрезки стен → грани → комнаты-полигоны.
 * СТАДИЯ 3 нового движка (после `wallVectorizer`).
 *
 * Идея вместо заливки светлых областей: стены пересекаются между собой и режут
 * плоскость на грани. Каждая ограниченная грань — помещение. Так форма комнаты
 * получается сразу полигоном (трапеции, Г-образные, скошенные), а число комнат
 * не зависит ни от длины стен, ни от их наклона.
 */

/** Точка пересечения двух отрезков; null, если не пересекаются. */
function intersect(a, b) {
  const r = [a.x2 - a.x1, a.y2 - a.y1]
  const s = [b.x2 - b.x1, b.y2 - b.y1]
  const denom = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(denom) < 1e-9) return null // параллельны
  const qp = [b.x1 - a.x1, b.y1 - a.y1]
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denom
  const eps = 1e-6
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  return { x: a.x1 + r[0] * t, y: a.y1 + r[1] * t, t, u }
}

/**
 * Разрезать отрезки во всех точках пересечения.
 * Заодно «дотягиваем» концы: стена, не доходящая до соседней пары пикселей,
 * оставила бы дырку в графе, и грань потекла бы наружу.
 */
function splitAtIntersections(segments, reach) {
  const cuts = segments.map(() => [0, 1])
  const grown = segments.map((s) => {
    const dx = s.x2 - s.x1
    const dy = s.y2 - s.y1
    const len = Math.hypot(dx, dy) || 1
    const k = reach / len
    return {
      x1: s.x1 - dx * k,
      y1: s.y1 - dy * k,
      x2: s.x2 + dx * k,
      y2: s.y2 + dy * k,
    }
  })
  for (let i = 0; i < grown.length; i++) {
    for (let j = i + 1; j < grown.length; j++) {
      const hit = intersect(grown[i], grown[j])
      if (!hit) continue
      cuts[i].push(hit.t)
      cuts[j].push(hit.u)
    }
  }
  const pieces = []
  for (let i = 0; i < grown.length; i++) {
    const ts = [...new Set(cuts[i].map((t) => Math.max(0, Math.min(1, t))))].sort((a, b) => a - b)
    const g = grown[i]
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k]
      const t1 = ts[k + 1]
      if (t1 - t0 < 1e-4) continue
      pieces.push({
        x1: g.x1 + (g.x2 - g.x1) * t0,
        y1: g.y1 + (g.y2 - g.y1) * t0,
        x2: g.x1 + (g.x2 - g.x1) * t1,
        y2: g.y1 + (g.y2 - g.y1) * t1,
      })
    }
  }
  return pieces
}

/** Граф: близкие концы склеиваются в одну вершину. */
function buildGraph(pieces, snap) {
  const verts = []
  const key = (x, y) => `${Math.round(x / snap)},${Math.round(y / snap)}`
  const index = new Map()
  const vertexAt = (x, y) => {
    const k = key(x, y)
    let id = index.get(k)
    if (id === undefined) {
      id = verts.length
      verts.push({ x, y, links: [] })
      index.set(k, id)
    }
    return id
  }
  for (const p of pieces) {
    const a = vertexAt(p.x1, p.y1)
    const b = vertexAt(p.x2, p.y2)
    if (a === b) continue
    if (!verts[a].links.includes(b)) verts[a].links.push(b)
    if (!verts[b].links.includes(a)) verts[b].links.push(a)
  }
  return verts
}

/** Убрать висячие концы: они не ограничивают грань, но ломают обход. */
function pruneDangling(verts) {
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < verts.length; i++) {
      if (verts[i].links.length !== 1) continue
      const j = verts[i].links[0]
      verts[i].links = []
      verts[j].links = verts[j].links.filter((n) => n !== i)
      changed = true
    }
  }
  return verts
}

/**
 * Обход граней. Для каждого направленного ребра идём «всё время направо»:
 * в конечной вершине берём соседа, следующего по часовой от обратного
 * направления. Каждое ребро проходится ровно дважды — по разу на грань.
 */
function traceFaces(verts) {
  const angle = (from, to) => Math.atan2(verts[to].y - verts[from].y, verts[to].x - verts[from].x)
  // соседи каждой вершины по возрастанию угла — чтобы искать следующего за O(log n)
  const sorted = verts.map((v, i) => v.links.slice().sort((a, b) => angle(i, a) - angle(i, b)))

  const seen = new Set()
  const faces = []
  for (let u = 0; u < verts.length; u++) {
    for (const v0 of sorted[u]) {
      if (seen.has(`${u}>${v0}`)) continue
      const cycle = []
      let a = u
      let b = v0
      let guard = 0
      while (guard++ < 4000) {
        seen.add(`${a}>${b}`)
        cycle.push(a)
        const ring = sorted[b]
        const back = ring.indexOf(a)
        if (back < 0) break
        // следующий по часовой от обратного направления
        const next = ring[(back - 1 + ring.length) % ring.length]
        a = b
        b = next
        if (a === u && b === v0) break
      }
      if (cycle.length >= 3) faces.push(cycle.map((i) => [verts[i].x, verts[i].y]))
    }
  }
  return faces
}

/** Знаковая площадь: знак говорит об ориентации обхода. */
function signedArea(poly) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** Убрать точки на прямых участках — грань из обхода избыточна. */
function dropCollinear(poly, tol = 0.6) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[(i + poly.length - 1) % poly.length]
    const c = poly[i]
    const n = poly[(i + 1) % poly.length]
    const cross = (c[0] - p[0]) * (n[1] - p[1]) - (c[1] - p[1]) * (n[0] - p[0])
    const base = Math.hypot(n[0] - p[0], n[1] - p[1]) || 1
    if (Math.abs(cross) / base > tol) out.push(c)
  }
  return out.length >= 3 ? out : poly
}

/**
 * Комнаты из отрезков стен.
 * @param {Array<{x1,y1,x2,y2}>} walls — осевые линии стен (wallVectorizer)
 * @param {number} w,h — габариты кадра, для отсева грани «весь кадр»
 * @returns {{ rooms: Array<{polygon: [number,number][], area: number}> }}
 */
export function buildRooms(walls, w, h) {
  if (!walls.length) return { rooms: [], faces: 0 }
  const minSide = Math.min(w, h)
  // Концы тянем щедро: на demo-12 при 2% габарита 182 вершины из 216
  // оказывались висячими — стены не дотягивались друг до друга, обрезка
  // съедала граф и оставалось 3 комнаты из 25.
  const reach = Math.max(6, Math.round(minSide * 0.05))
  const snap = Math.max(2, Math.round(minSide * 0.012))

  const pieces = splitAtIntersections(walls, reach)
  const verts = pruneDangling(buildGraph(pieces, snap))
  const faces = traceFaces(verts)

  const frameArea = w * h
  const minArea = Math.max(300, frameArea * 0.002)
  const rooms = []
  for (const face of faces) {
    const area = signedArea(face)
    // Внешняя грань обходится в другую сторону — отсекается по знаку.
    // Порог снизу убирает «карманы» внутри толщины стен.
    if (area <= minArea) continue
    if (area > frameArea * 0.85) continue
    const poly = dropCollinear(face)
    rooms.push({ polygon: poly.map(([x, y]) => [Math.round(x), Math.round(y)]), area })
  }
  rooms.sort((a, b) => b.area - a.area)
  return { rooms, faces: faces.length }
}
