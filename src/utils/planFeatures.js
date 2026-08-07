/**
 * Проёмы и лестницы из векторной геометрии — СТАДИЯ 4 нового движка.
 *
 * Отличие от старого движка: там двери искались как разрывы на рёбрах
 * ПРЯМОУГОЛЬНИКА комнаты, а лестница — только внутри узкой высокой комнаты.
 * Здесь и то и другое выводится из самих отрезков, поэтому работает при любом
 * наклоне стены и в том числе за пределами здания (наружные крыльца).
 */

/** Точка внутри полигона (луч вправо). */
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
 * Разрывы вдоль стены = проёмы.
 * Сшивка коллинеарных кусков (стадия 2) специально перешагивает дверные
 * разрывы, чтобы граф был связным. Здесь мы их возвращаем: идём по осевой
 * линии стены и смотрим, где под ней нет чернил.
 */
function gapsAlong(wall, ink, w, h, minGap, maxGap) {
  const dx = wall.x2 - wall.x1
  const dy = wall.y2 - wall.y1
  const len = Math.hypot(dx, dy)
  if (len < 4) return []
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const half = Math.max(2, Math.round((wall.thickness ?? 2) / 2) + 1)
  const solid = (t) => {
    const px = wall.x1 + ux * t
    const py = wall.y1 + uy * t
    for (let n = -half; n <= half; n++) {
      const x = Math.round(px + nx * n)
      const y = Math.round(py + ny * n)
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (ink[y * w + x]) return true
    }
    return false
  }
  const out = []
  let start = null
  for (let t = 0; t <= len; t++) {
    if (!solid(t)) {
      if (start === null) start = t
    } else if (start !== null) {
      const width = t - start
      // проёмы у самого края стены — это её незакрытый конец, а не дверь
      if (width >= minGap && width <= maxGap && start > 2 && t < len - 2) {
        const mid = start + width / 2
        out.push({ x: wall.x1 + ux * mid, y: wall.y1 + uy * mid, width, ux, uy, nx, ny })
      }
      start = null
    }
  }
  return out
}

/**
 * Проёмы с разбором на двери и окна.
 * Дверь — по обе стороны помещение. Окно — с одной стороны помещение,
 * с другой улица.
 */
export function findOpenings(walls, ink, w, h, rooms) {
  const minSide = Math.min(w, h)
  const minGap = Math.max(5, Math.round(minSide * 0.02))
  const maxGap = Math.max(18, Math.round(minSide * 0.14))
  const doors = []
  const windows = []
  const step = Math.max(4, Math.round(minSide * 0.03))

  for (const wall of walls) {
    for (const gap of gapsAlong(wall, ink, w, h, minGap, maxGap)) {
      const sideA = rooms.some((r) =>
        inside(r.polygon, gap.x + gap.nx * step, gap.y + gap.ny * step),
      )
      const sideB = rooms.some((r) =>
        inside(r.polygon, gap.x - gap.nx * step, gap.y - gap.ny * step),
      )
      const item = { x: gap.x, y: gap.y, width: gap.width, ux: gap.ux, uy: gap.uy }
      if (sideA && sideB) doors.push(item)
      else if (sideA || sideB) windows.push(item)
    }
  }
  return { doors, windows }
}

/**
 * Лестницы: группы параллельных отрезков одинаковой длины с равным шагом.
 * Угол любой, привязка к комнате не нужна — поэтому находятся и наружные
 * крыльца, которых старый движок не видел в принципе.
 */
export function findStairFlights(segments, w, h) {
  const minSide = Math.min(w, h)
  const minTreads = 5
  const used = new Set()
  const flights = []
  const dirOf = (s) => {
    const dx = s.x2 - s.x1
    const dy = s.y2 - s.y1
    const len = Math.hypot(dx, dy) || 1
    return { ux: dx / len, uy: dy / len, len, mx: (s.x1 + s.x2) / 2, my: (s.y1 + s.y2) / 2 }
  }
  const info = segments.map(dirOf)

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue
    const a = info[i]
    if (a.len > minSide * 0.5) continue // длинная линия — стена, не ступень
    // все отрезки, параллельные i и похожие по длине
    const group = [i]
    for (let j = 0; j < segments.length; j++) {
      if (j === i || used.has(j)) continue
      const b = info[j]
      if (Math.abs(a.ux * b.ux + a.uy * b.uy) < Math.cos((7 * Math.PI) / 180)) continue
      if (Math.abs(a.len - b.len) > Math.max(6, a.len * 0.4)) continue
      group.push(j)
    }
    if (group.length < minTreads) continue
    // шаг поперёк направления должен быть равномерным
    const nx = -a.uy
    const ny = a.ux
    const proj = group
      .map((k) => ({ k, d: info[k].mx * nx + info[k].my * ny }))
      .sort((p, q) => p.d - q.d)
    let run = [proj[0]]
    const runs = []
    for (let k = 1; k < proj.length; k++) {
      const stepSize = proj[k].d - proj[k - 1].d
      const prev = run.length > 1 ? run[run.length - 1].d - run[run.length - 2].d : stepSize
      if (stepSize > 1 && stepSize < minSide * 0.12 && Math.abs(stepSize - prev) <= 3) {
        run.push(proj[k])
      } else {
        if (run.length >= minTreads) runs.push(run)
        run = [proj[k]]
      }
    }
    if (run.length >= minTreads) runs.push(run)

    for (const r of runs) {
      for (const p of r) used.add(p.k)
      const treads = r.map((p) => segments[p.k])
      flights.push({
        treads: treads.map((t) => ({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 })),
        count: treads.length,
      })
    }
  }
  return flights
}
