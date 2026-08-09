/**
 * Векторизация стен — ПЕРВАЯ ВЕХА нового движка (стадии 1–2).
 *
 * Зачем: действующий `planExtractor` ищет стены как горизонтальные и
 * вертикальные линии с покрытием «почти во всю ширину плана». Из-за этого он
 * не видит диагонали, короткие внутренние стены и стены, нарисованные двойной
 * линией. Здесь принцип другой:
 *
 *   1. Отделить обвязку (подписи) от конструкции.
 *   2. Найти отрезки ЛЮБОГО наклона (преобразование Хафа) и сшить пары
 *      параллельных граней в одну стену с толщиной.
 *
 * Плана эта веха не строит — только отдаёт найденные отрезки, чтобы наложить
 * их поверх исходного чертежа и глазами проверить, ловятся стены или нет.
 * Стадия 3 (планарное разбиение → комнаты-полигоны) появится, если да.
 */

/** Мягкая бинаризация: тонкие серые линии чертежа тоже чернила. */
function inkOf(data, w, h, threshold = 215) {
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const lum = (data[o] + data[o + 1] + data[o + 2]) / 3
    ink[i] = lum < threshold ? 1 : 0
  }
  return ink
}

/** Связные компоненты (8-связность): тонкий штрих не рвётся по диагонали. */
function components(mask, w, h, minSize) {
  const seen = new Uint8Array(w * h)
  const out = []
  const stack = []
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    const cells = []
    let minX = start % w
    let maxX = minX
    let minY = (start / w) | 0
    let maxY = minY
    while (stack.length) {
      const p = stack.pop()
      cells.push(p)
      const px = p % w
      const py = (p / w) | 0
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const nb = ny * w + nx
          if (mask[nb] && !seen[nb]) {
            seen[nb] = 1
            stack.push(nb)
          }
        }
      }
    }
    if (cells.length >= minSize) {
      out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, cells })
    }
  }
  return out
}

/**
 * СТАДИЯ 1. Убрать подписи и размерные числа.
 * Признак цифры/буквы — мелкая компонента, у которой рядом есть соседи такого
 * же кегля. Одиночная мелочь (засечка размерной линии) не трогается: на этой
 * вехе важнее не потерять стену, чем убрать лишнее.
 */
function textCells(comps, w, h) {
  const glyphMax = Math.max(9, Math.round(Math.min(w, h) * 0.05))
  const glyphs = comps.filter((c) => c.w <= glyphMax * 2 && c.h <= glyphMax)
  const drop = new Set()
  for (let i = 0; i < glyphs.length; i++) {
    let neighbours = 0
    for (let j = 0; j < glyphs.length; j++) {
      if (i === j) continue
      const a = glyphs[i]
      const b = glyphs[j]
      const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)
      const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)
      const near = Math.max(a.h, b.h) * 1.4
      if (gapX <= near && gapY <= near) neighbours++
      if (neighbours >= 2) break
    }
    if (neighbours >= 2) drop.add(glyphs[i])
  }
  return drop
}

/**
 * Утоньшение по Чжану–Суэню: полоса чернил любой толщины сводится к линии
 * шириной в пиксель. Без этого шага сплошная стена в 8px даёт Хафа не одну
 * прямую, а частокол близких — по одной на каждый ряд пикселей, и дальше всё
 * рассыпается (проверено на первой попытке: 370 «стен» вместо тридцати).
 */
function thin(mask, w, h) {
  const img = Uint8Array.from(mask)
  const doomed = []
  let changed = true
  let guard = 0
  while (changed && guard++ < 40) {
    changed = false
    for (let step = 0; step < 2; step++) {
      doomed.length = 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (!img[i]) continue
          // соседи по часовой начиная сверху
          const p2 = img[i - w]
          const p3 = img[i - w + 1]
          const p4 = img[i + 1]
          const p5 = img[i + w + 1]
          const p6 = img[i + w]
          const p7 = img[i + w - 1]
          const p8 = img[i - 1]
          const p9 = img[i - w - 1]
          const filled = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (filled < 2 || filled > 6) continue
          // число переходов 0→1 по кругу должно быть ровно одно,
          // иначе удаление разорвёт линию
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let transitions = 0
          for (let k = 0; k < 8; k++) if (!ring[k] && ring[k + 1]) transitions++
          if (transitions !== 1) continue
          if (step === 0) {
            if (p2 && p4 && p6) continue
            if (p4 && p6 && p8) continue
          } else {
            if (p2 && p4 && p8) continue
            if (p2 && p6 && p8) continue
          }
          doomed.push(i)
        }
      }
      if (doomed.length) {
        changed = true
        for (const i of doomed) img[i] = 0
      }
    }
  }
  return img
}

/** Толщина стены в точке: сколько чернил поперёк линии в ИСХОДНОЙ маске. */
function thicknessAt(ink, w, h, x, y, theta) {
  const nx = Math.cos(theta)
  const ny = Math.sin(theta)
  let t = 1
  for (let d = 1; d <= 12; d++) {
    const ax = Math.round(x + nx * d)
    const ay = Math.round(y + ny * d)
    if (ax < 0 || ay < 0 || ax >= w || ay >= h || !ink[ay * w + ax]) break
    t++
  }
  for (let d = 1; d <= 12; d++) {
    const ax = Math.round(x - nx * d)
    const ay = Math.round(y - ny * d)
    if (ax < 0 || ay < 0 || ax >= w || ay >= h || !ink[ay * w + ax]) break
    t++
  }
  return t
}

/**
 * СТАДИЯ 2. Преобразование Хафа: копим голоса за прямые (угол, смещение).
 * Угол берём с шагом в градус — этого хватает, чтобы отличить скос от прямой.
 */
function houghPeaks(ink, w, h, minVotes) {
  const steps = 180
  const cos = new Float32Array(steps)
  const sin = new Float32Array(steps)
  for (let t = 0; t < steps; t++) {
    const a = (t * Math.PI) / steps
    cos[t] = Math.cos(a)
    sin[t] = Math.sin(a)
  }
  const diag = Math.ceil(Math.hypot(w, h))
  const rhoCount = diag * 2 + 1
  const acc = new Int32Array(steps * rhoCount)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue
      for (let t = 0; t < steps; t++) {
        const rho = Math.round(x * cos[t] + y * sin[t]) + diag
        acc[t * rhoCount + rho]++
      }
    }
  }
  // Локальные максимумы: одна стена не должна давать десяток соседних прямых
  const peaks = []
  for (let t = 0; t < steps; t++) {
    for (let r = 1; r < rhoCount - 1; r++) {
      const v = acc[t * rhoCount + r]
      if (v < minVotes) continue
      let isMax = true
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        const tt = (t + dt + steps) % steps
        for (let dr = -3; dr <= 3; dr++) {
          if (!dt && !dr) continue
          const rr = r + dr
          if (rr < 0 || rr >= rhoCount) continue
          if (acc[tt * rhoCount + rr] > v) {
            isMax = false
            break
          }
        }
      }
      if (isMax) peaks.push({ theta: (t * Math.PI) / steps, rho: r - diag, votes: v })
    }
  }
  return peaks.sort((a, b) => b.votes - a.votes).slice(0, 400)
}

/**
 * По прямой пройти вдоль и вырезать реальные куски с чернилами.
 * Разрывы до `maxGap` считаются проёмами и не рвут отрезок.
 */
function segmentsOnLine(ink, w, h, peak, minLen, maxGap, minFill = 0.72) {
  const { theta, rho } = peak
  const ct = Math.cos(theta)
  const st = Math.sin(theta)
  // Точка на прямой + направляющий вектор (перпендикуляр к нормали)
  const x0 = ct * rho
  const y0 = st * rho
  const dx = -st
  const dy = ct
  const span = Math.ceil(Math.hypot(w, h))
  const hit = (t) => {
    const x = Math.round(x0 + dx * t)
    const y = Math.round(y0 + dy * t)
    if (x < 0 || y < 0 || x >= w || y >= h) return false
    // допуск ±1px поперёк: линия толщиной в пиксель не должна теряться
    for (let n = -1; n <= 1; n++) {
      const nx = Math.round(x + -st * 0 + ct * n)
      const ny = Math.round(y + st * n)
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      if (ink[ny * w + nx]) return true
    }
    return false
  }
  const out = []
  let runStart = null
  let gap = 0
  let filled = 0
  /**
   * Настоящая стена — почти сплошная линия. Прямая Хафа может пройти через
   * случайно выровненные пятна (штрихи подписей, засечки размеров) и дать
   * «отрезок» из редких попаданий — такие отсекаем по доле заполнения.
   */
  const flush = (end) => {
    const length = end - runStart
    if (length >= minLen && filled / Math.max(1, length) >= minFill) {
      out.push({
        x1: Math.round(x0 + dx * runStart),
        y1: Math.round(y0 + dy * runStart),
        x2: Math.round(x0 + dx * end),
        y2: Math.round(y0 + dy * end),
        theta,
      })
    }
    runStart = null
    filled = 0
  }
  for (let t = -span; t <= span; t++) {
    if (hit(t)) {
      if (runStart === null) {
        runStart = t
        filled = 0
      }
      filled++
      gap = 0
    } else if (runStart !== null) {
      gap++
      if (gap > maxGap) flush(t - gap)
    }
  }
  if (runStart !== null) flush(span)
  return out
}

/** Отрезок «почти совпадает» с уже принятым? */
function isDuplicate(seg, kept, tol) {
  const near = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) <= tol
  return kept.some(
    (k) =>
      (near(k.x1, k.y1, seg.x1, seg.y1) && near(k.x2, k.y2, seg.x2, seg.y2)) ||
      (near(k.x1, k.y1, seg.x2, seg.y2) && near(k.x2, k.y2, seg.x1, seg.y1)),
  )
}

/**
 * Сшить коллинеарные куски в целую стену.
 * Хафа режет стену на части там, где её пересекают перегородки или где
 * дверной проём шире допуска. Для планарного разбиения это плохо: граф
 * получается дырявым и грани комнат «текут» друг в друга.
 *
 * Куски считаются одной стеной, если они почти сонаправлены, лежат на одной
 * прямой (малое смещение поперёк) и либо перекрываются, либо разделены
 * разрывом не шире дверного проёма.
 */
function mergeCollinear(segments, angleTol, offsetTol, gapTol) {
  const dirOf = (s) => {
    const dx = s.x2 - s.x1
    const dy = s.y2 - s.y1
    const len = Math.hypot(dx, dy) || 1
    return [dx / len, dy / len, len]
  }
  let list = segments.map((s) => ({ ...s }))
  let merged = true
  let guard = 0
  while (merged && guard++ < 20) {
    merged = false
    const out = []
    const used = new Set()
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue
      let cur = list[i]
      used.add(i)
      let grew = true
      while (grew) {
        grew = false
        const [ux, uy, ulen] = dirOf(cur)
        for (let j = 0; j < list.length; j++) {
          if (used.has(j)) continue
          const other = list[j]
          const [vx, vy, vlen] = dirOf(other)
          // сонаправленность (знак направления не важен)
          const cosA = Math.abs(ux * vx + uy * vy)
          if (cosA < Math.cos(angleTol)) continue
          // смещение поперёк: обе точки чужого куска близко к нашей прямой
          const off = (px, py) => Math.abs((px - cur.x1) * -uy + (py - cur.y1) * ux)
          if (off(other.x1, other.y1) > offsetTol || off(other.x2, other.y2) > offsetTol) continue
          // перекрытие или дверной разрыв вдоль направления
          const proj = (px, py) => (px - cur.x1) * ux + (py - cur.y1) * uy
          const a0 = 0
          const a1 = ulen
          const b0 = Math.min(proj(other.x1, other.y1), proj(other.x2, other.y2))
          const b1 = Math.max(proj(other.x1, other.y1), proj(other.x2, other.y2))
          const gap = Math.max(a0, b0) - Math.min(a1, b1)
          if (gap > gapTol) continue
          // объединяем: берём крайние точки вдоль направления
          const lo = Math.min(a0, b0)
          const hi = Math.max(a1, b1)
          cur = {
            x1: cur.x1 + ux * lo,
            y1: cur.y1 + uy * lo,
            x2: cur.x1 + ux * hi,
            y2: cur.y1 + uy * hi,
            theta: ulen >= vlen ? cur.theta : other.theta,
          }
          used.add(j)
          merged = true
          grew = true
        }
      }
      out.push(cur)
    }
    list = out
  }
  return list.map((s) => ({
    x1: Math.round(s.x1),
    y1: Math.round(s.y1),
    x2: Math.round(s.x2),
    y2: Math.round(s.y2),
    theta: s.theta,
  }))
}

/**
 * Сшить пары параллельных граней в одну стену.
 * На чертежах стену рисуют двумя линиями: без этого шага движок видит две
 * разные стены и пустоту между ними — из-за чего заливка комнат течёт.
 */
/**
 * Настоящая ли это пара граней одной стены — проверяем по чернилам.
 * Осевая линия должна идти ВНУТРИ стены: чернила есть и выше её, и ниже.
 * Ложная пара (длинная стена + случайный обрубок) уводит осевую в пустоту,
 * и тогда чернила лежат только с одной стороны.
 */
function pairLooksReal(x1, y1, x2, y2, thickness, ink, w, h) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 2) return true
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const half = Math.max(2, Math.round(thickness / 2) + 1)
  const samples = Math.min(60, Math.max(8, Math.round(len / 4)))
  let ok = 0
  for (let k = 0; k < samples; k++) {
    const t = (len * k) / (samples - 1 || 1)
    const px = x1 + ux * t
    const py = y1 + uy * t
    let up = false
    let down = false
    for (let n = -half; n <= half; n++) {
      const x = Math.round(px + nx * n)
      const y = Math.round(py + ny * n)
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (!ink[y * w + x]) continue
      if (n < 0) up = true
      if (n > 0) down = true
    }
    if (up && down) ok++
  }
  return ok >= samples * 0.5
}

function pairFaces(segments, maxThickness, ink, w, h) {
  const used = new Set()
  const walls = []
  const mid = (s) => [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2]
  const len = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue
    const a = segments[i]
    let mate = -1
    let mateDist = Infinity
    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue
      const b = segments[j]
      let dTheta = Math.abs(a.theta - b.theta)
      dTheta = Math.min(dTheta, Math.PI - dTheta)
      // У коротких отрезков направление меряется грубее: две грани скошенного
      // угла коттеджа (по 25–35 px) вышли под 132° и 147°, и при допуске 5°
      // не спаривались. Тогда угол оставался двумя линиями, между ними
      // замыкалась щель, и контур делал шип наружу и обратно.
      const shortest = Math.min(len(a), len(b))
      const tol = shortest < maxThickness * 4 ? 0.3 : 0.09
      if (dTheta > tol) continue
      // расстояние между параллельными прямыми
      const [mx, my] = mid(b)
      const nx = Math.cos(a.theta)
      const ny = Math.sin(a.theta)
      const dist = Math.abs((mx - a.x1) * nx + (my - a.y1) * ny)
      if (dist < 1.5 || dist > maxThickness) continue
      // должны перекрываться вдоль своего направления
      const dx = -Math.sin(a.theta)
      const dy = Math.cos(a.theta)
      const proj = (px, py) => px * dx + py * dy
      const a0 = Math.min(proj(a.x1, a.y1), proj(a.x2, a.y2))
      const a1 = Math.max(proj(a.x1, a.y1), proj(a.x2, a.y2))
      const b0 = Math.min(proj(b.x1, b.y1), proj(b.x2, b.y2))
      const b1 = Math.max(proj(b.x1, b.y1), proj(b.x2, b.y2))
      const overlap = Math.min(a1, b1) - Math.max(a0, b0)
      // Перекрытие меряем по ДЛИННОЙ грани. По короткой проверка пропускала
      // огрызки: на демо стена коридора длиной 562 px спаривалась с обрубком
      // в 18 px у лестничной шахты, осевая уезжала на 6 px в пустоту, и вся
      // стена читалась как несплошная — двери нижнего ряда пропадали.
      if (overlap < Math.min(len(a), len(b)) * 0.5) continue
      if (dist < mateDist) {
        mateDist = dist
        mate = j
      }
    }
    if (mate >= 0) {
      const b = segments[mate]
      // Осевая линия — по ОБЪЕДИНЕНИЮ граней вдоль стены, не по среднему их
      // концов. Грани двойной стены редко одинаковой длины: у демо нижняя
      // стена коридора идёт x24..586, а верхняя только x166..456, и среднее
      // давало огрызок x95..521. Стены не хватало до углов, планарный обход
      // не замыкал грани — коридор слипался с нижним рядом кабинетов.
      const nx = Math.cos(a.theta)
      const ny = Math.sin(a.theta)
      const dx = -Math.sin(a.theta)
      const dy = Math.cos(a.theta)
      const along = (px, py) => px * dx + py * dy
      const across = (px, py) => px * nx + py * ny
      const ts = [
        along(a.x1, a.y1),
        along(a.x2, a.y2),
        along(b.x1, b.y1),
        along(b.x2, b.y2),
      ]
      const t0 = Math.min(...ts)
      const t1 = Math.max(...ts)
      const off = (across(a.x1, a.y1) + across(b.x1, b.y1)) / 2
      const wx1 = dx * t0 + nx * off
      const wy1 = dy * t0 + ny * off
      const wx2 = dx * t1 + nx * off
      const wy2 = dy * t1 + ny * off
      if (pairLooksReal(wx1, wy1, wx2, wy2, mateDist, ink, w, h)) {
        used.add(i)
        used.add(mate)
        walls.push({ x1: wx1, y1: wy1, x2: wx2, y2: wy2, thickness: mateDist, paired: true })
      } else {
        // Пара не подтвердилась — грань идёт в стены сама по себе,
        // а её несостоявшийся напарник остаётся свободным для других пар.
        used.add(i)
        walls.push({ x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, thickness: 1, paired: false })
      }
    } else {
      used.add(i)
      walls.push({ x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, thickness: 1, paired: false })
    }
  }
  return walls
}

/**
 * Векторизовать стены чертежа.
 * @param {ImageData} imageData — тот же кадр, что уходит в planExtractor
 * @returns {{ w, h, walls, segments, droppedText: number }}
 */
export function vectorizeWalls(imageData) {
  const w = imageData.width
  const h = imageData.height
  const ink = inkOf(imageData.data, w, h)
  // Жёсткий порог: только тело стены. Створки дверей и линии стекла рисуют
  // светло-серым — в мягкую маску они попадают, и проём выглядит заполненным.
  const inkHard = inkOf(imageData.data, w, h, 140)

  // --- Стадия 1: убрать подписи ---
  const comps = components(ink, w, h, 4)
  const drop = textCells(comps, w, h)
  const structure = new Uint8Array(ink)
  for (const c of drop) {
    for (const p of c.cells) structure[p] = 0
  }

  // --- Стадия 2: прямые → отрезки → стены ---
  // Скелет: стена любой толщины → линия в пиксель. Голосуем и режем отрезки
  // по нему, а толщину потом меряем по исходным чернилам.
  const skeleton = thin(structure, w, h)

  const minSide = Math.min(w, h)
  const minVotes = Math.max(18, Math.round(minSide * 0.07))
  const minLen = Math.max(14, Math.round(minSide * 0.05))
  const maxGap = Math.max(4, Math.round(minSide * 0.02))
  const peaks = houghPeaks(skeleton, w, h, minVotes)

  // Прямые разбираем от самой «голосистой» и ВЫЧЁРКИВАЕМ израсходованные
  // пиксели: иначе одна стена кормит десяток почти совпадающих прямых, и
  // отрезков выходит на порядок больше, чем стен на чертеже.
  const work = Uint8Array.from(skeleton)
  const erase = (seg) => {
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)
    const steps = Math.ceil(len)
    const nx = Math.cos(seg.theta)
    const ny = Math.sin(seg.theta)
    for (let k = 0; k <= steps; k++) {
      const t = k / Math.max(1, steps)
      const px = seg.x1 + (seg.x2 - seg.x1) * t
      const py = seg.y1 + (seg.y2 - seg.y1) * t
      for (let n = -2; n <= 2; n++) {
        const x = Math.round(px + nx * n)
        const y = Math.round(py + ny * n)
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        work[y * w + x] = 0
      }
    }
  }
  const segments = []
  for (const peak of peaks) {
    for (const seg of segmentsOnLine(work, w, h, peak, minLen, maxGap)) {
      if (isDuplicate(seg, segments, 6)) continue
      segments.push(seg)
      erase(seg)
    }
  }

  // Куски одной стены сшиваем ДО парности: иначе грань, разрезанная на три
  // части, ищет себе пару по каждому куску отдельно.
  const whole = mergeCollinear(
    segments,
    (6 * Math.PI) / 180,
    Math.max(4, Math.round(minSide * 0.012)),
    Math.max(12, Math.round(minSide * 0.1)),
  )

  const walls = pairFaces(
    whole,
    Math.max(10, Math.round(minSide * 0.06)),
    inkHard,
    w,
    h,
  ).map((wall) => {
    if (wall.paired) return wall
    const mx = Math.round((wall.x1 + wall.x2) / 2)
    const my = Math.round((wall.y1 + wall.y2) / 2)
    const theta = Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1) + Math.PI / 2
    // Толщину меряем в НЕСКОЛЬКИХ точках и берём медиану. В одной точке
    // ошибиться легко: середина перегородки между кабинками санузла на демо
    // приходится ровно на пересечение с вертикальной стеной, и толщина
    // выходила 25 px при реальных двух. Полоса просмотра раздувалась, дверные
    // разрывы в ней тонули, и двери кабинок пропадали все до одной.
    const probes = []
    for (let k = 1; k <= 7; k++) {
      const f = k / 8
      probes.push(
        thicknessAt(
          ink,
          w,
          h,
          Math.round(wall.x1 + (wall.x2 - wall.x1) * f),
          Math.round(wall.y1 + (wall.y2 - wall.y1) * f),
          theta,
        ),
      )
    }
    probes.sort((a, b) => a - b)
    const median = probes[Math.floor(probes.length / 2)]
    return { ...wall, thickness: median || thicknessAt(ink, w, h, mx, my, theta) }
  })
  return { w, h, ink, inkHard, walls, segments: whole, rawSegments: segments, skeletonPixels: skeleton.reduce((a, b) => a + b, 0), droppedText: drop.size }
}
