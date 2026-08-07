/**
 * Движок анализа чертежа: ч/б линейный И цветные схемы.
 *
 * Автовыбор режима:
 *   - color: пастельные заливки комнат + серо-синие стены + голубые окна
 *   - bw: тёмные линии на светлом фоне
 *
 * Пайплайн BW:
 *   1. Бинаризация → мажорные H/V стены → маска → flood-fill комнат
 *   2. Snap + clip → проёмы на рёбрах → лестница/сантехника/мебель
 *
 * Пайплайн Color (как oas/extract-plan.py):
 *   1. Маски: wall / fill / cyan / dark
 *   2. Комнаты из цветной заливки (CC)
 *   3. Окна из голубых пятен на периметре
 *   4. Двери — проёмы в wall-маске на рёбрах комнат
 *   5. Лестница/сантехника/мебель по dark-блобам
 *
 * Приёмы: make-stage.md §8.5.
 */

/** Бинаризация: 1 = тёмный пиксель. */
function toBinary(data, w, h) {
  const bin = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const lum = (data[o] + data[o + 1] + data[o + 2]) / 3
    bin[i] = lum < 160 ? 1 : 0
  }
  return bin
}

/**
 * Цветовые маски для цветных схем (универсальный / Demo).
 * @returns {{ wall, fill, cyan, dark, ink, wallN, fillN, cyanN, total, mode }}
 */
function buildColorMasks(data, w, h) {
  const n = w * h
  const wall = new Uint8Array(n)
  const fill = new Uint8Array(n)
  const cyan = new Uint8Array(n)
  const dark = new Uint8Array(n)
  const ink = new Uint8Array(n) // стены + тёмные линии (мебель/ступени)
  let wallN = 0
  let fillN = 0
  let cyanN = 0
  let chromaN = 0

  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    const lum = (r + g + b) / 3
    const maxc = Math.max(r, g, b)
    const minc = Math.min(r, g, b)
    const chroma = maxc - minc

    if (chroma >= 12) chromaN++

    // Голубые ОКНА (светлый cyan на периметре)
    const isCyanWin =
      g > 200 && b > 200 && r > 140 && r < 235 && g - r > 8 && b - r > 12 && lum > 180
    // Голубая САНТЕХНИКА (насыщенный cyan/azure #40C0F0, низкий R)
    const isCyanFix =
      r < 160 && g > 140 && b > 180 && b - r > 40 && g - r > 20 && lum > 120 && lum < 235
    const isCyan = isCyanWin || isCyanFix
    if (isCyan) {
      cyan[i] = 1
      cyanN++
    }

    // Пастельная заливка комнат: яркая, с хромой, не cyan
    const isYellow =
      r > 225 && g > 205 && b > 155 && b < 235 && r - b > 18 && !isCyan
    const isPink =
      r > 215 && g > 185 && b > 185 && r > g + 4 && r > b + 4 && lum > 205 && chroma >= 10 && !isCyan
    const isMint =
      g > 205 && r > 185 && b > 185 && g >= r && g >= b && lum > 205 && lum < 248 && chroma >= 10 && !isCyan
    const isLav =
      b > 205 && r > 185 && g > 185 && b >= r && b >= g && lum > 205 && lum < 248 && chroma >= 10 && !isCyan
    const isWarmGray =
      lum > 210 &&
      lum < 245 &&
      chroma >= 8 &&
      chroma < 35 &&
      r >= g - 5 &&
      g >= b - 5 &&
      r - b > 8 &&
      !isCyan
    // голубоватая заливка санузлов (#E0F0F0)
    const isSanFill =
      lum > 200 &&
      lum < 245 &&
      b >= g - 5 &&
      g >= r - 5 &&
      chroma >= 8 &&
      chroma < 45 &&
      !isCyan
    if ((isYellow || isPink || isMint || isLav || isWarmGray || isSanFill) && lum < 252) {
      fill[i] = 1
      fillN++
    }

    // Стены: тёмный slate + СВЕТЛЫЙ slate/gray верхней части плана
    const isSlate =
      lum > 35 &&
      lum < 175 &&
      r >= 35 &&
      r <= 160 &&
      g >= 45 &&
      g <= 180 &&
      b >= 55 &&
      b <= 200 &&
      Math.abs(b - g) < 55
    const isGray =
      lum > 70 && lum < 210 && Math.abs(r - g) < 28 && Math.abs(g - b) < 28 && chroma < 36
    const isLightWall =
      lum >= 130 &&
      lum <= 220 &&
      chroma < 45 &&
      Math.abs(r - g) < 35 &&
      Math.abs(g - b) < 40 &&
      !isCyan &&
      !fill[i] &&
      lum < 225
    const isOrange = r > 200 && g > 80 && g < 190 && b < 130 && r > g && r - b > 40
    const isLightOrange =
      r > 200 &&
      g > 100 &&
      g < 210 &&
      b > 40 &&
      b < 170 &&
      r >= g &&
      r - b > 25 &&
      lum > 130 &&
      lum < 230 &&
      !isCyan &&
      !fill[i]
    if (isSlate || isGray || isLightWall || isOrange || isLightOrange) {
      wall[i] = 1
      wallN++
      ink[i] = 1
    }

    if (lum < 145 && !isCyan) {
      dark[i] = 1
      ink[i] = 1
    } else if (lum < 175 && chroma < 30 && !isCyan && !fill[i]) {
      ink[i] = 1
    }
  }

  const total = n
  const fillRatio = fillN / total
  const cyanRatio = cyanN / total
  const wallRatio = wallN / total
  const chromaRatio = chromaN / total
  // Цветной план: есть заметная заливка комнат И (окна или цветные стены)
  const mode =
    fillRatio > 0.02 && (cyanRatio > 0.001 || wallRatio > 0.01) && chromaRatio > 0.05
      ? 'color'
      : 'bw'

  // Вторая маска: только насыщенная сантехника (не оконный cyan)
  const cyanFix = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    const lum = (r + g + b) / 3
    if (r < 160 && g > 140 && b > 180 && b - r > 40 && g - r > 20 && lum > 120 && lum < 235) {
      cyanFix[i] = 1
    }
  }

  return {
    wall,
    fill,
    cyan,
    cyanFix,
    dark,
    ink,
    wallN,
    fillN,
    cyanN,
    total,
    mode,
    fillRatio,
    cyanRatio,
    wallRatio,
  }
}

/** Серии 1 в массиве 0/1 → [start, end] включительно. */
function clusters(arr, gap = 2, minLen = 2) {
  const out = []
  let start = -1
  let prev = -1
  for (let i = 0; i <= arr.length; i++) {
    const v = i < arr.length ? arr[i] : 0
    if (v === 1) {
      if (start === -1) start = i
      prev = i
    } else if (start !== -1) {
      if (i - prev - 1 > gap || i === arr.length) {
        if (prev - start + 1 >= minLen) out.push([start, prev])
        start = -1
      }
    }
  }
  return out
}

/** Склеить соседние [s,e] с зазором ≤ gap. */
function mergeRanges(ranges, gap = 30) {
  if (!ranges.length) return []
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out = [[sorted[0][0], sorted[0][1]]]
  for (const [s, e] of sorted.slice(1)) {
    if (s - out[out.length - 1][1] <= gap) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e)
    else out.push([s, e])
  }
  return out
}

/**
 * Мажорные горизонтальные стены (несущие).
 * gap 50 — двери/окна/лестница не рвут стену.
 * Покрытие сегментов ≥ 48% ширины + плотность тёмных в полосе ≥ 0.42
 * (мебель-столы дают длинный span после merge, но низкую плотность).
 */
function findMajorHWalls(bin, w, h) {
  const minCov = Math.max(150, Math.floor(w * 0.48))
  const minSeg = Math.max(40, Math.floor(w * 0.08))
  const rowYs = []
  const rowSegs = new Map()
  for (let y = 0; y < h; y++) {
    const row = new Array(w)
    for (let x = 0; x < w; x++) row[x] = bin[y * w + x]
    const segs = mergeRanges(clusters(row, 1, 3), 50).filter(([s, e]) => e - s + 1 >= minSeg)
    if (!segs.length) continue
    const cov = segs.reduce((s, [a, b]) => s + (b - a + 1), 0)
    if (cov < minCov) continue
    // Плотность: доля реально тёмных пикселей в span сегментов
    let spanDark = 0
    let spanLen = 0
    for (const [s, e] of segs) {
      spanLen += e - s + 1
      for (let x = s; x <= e; x++) spanDark += row[x]
    }
    // Несущая стена ≈ сплошная линия; мебель после merge — «дырявая»
    if (spanLen > 0 && spanDark / spanLen < 0.5) continue
    rowYs.push(y)
    rowSegs.set(y, segs)
  }
  return clusterAxis(rowYs, 3).map(({ lo, hi, mid }) => {
    let x0 = Infinity
    let x1 = -Infinity
    for (let y = lo; y <= hi; y++) {
      for (const [s, e] of rowSegs.get(y) ?? []) {
        x0 = Math.min(x0, s)
        x1 = Math.max(x1, e)
      }
    }
    return { y: mid, x0, x1, y0: lo, y1: hi }
  })
}

/**
 * Мажорные вертикальные стены.
 * Порог ниже: стены верхнего ряда комнат короткие (~80–120px),
 * но должны находиться (иначе нет перегородок сверху).
 */
function findMajorVWalls(bin, w, h, hWallYs = []) {
  // 12% высоты или ≥45px — ловит стены одного ряда комнат
  const minCov = Math.max(45, Math.floor(h * 0.12))
  const minSeg = Math.max(28, Math.floor(h * 0.08))
  const colXs = []
  const colSegs = new Map()
  for (let x = 0; x < w; x++) {
    const col = new Array(h)
    for (let y = 0; y < h; y++) col[y] = bin[y * w + x]
    const segs = mergeRanges(clusters(col, 1, 3), 40).filter(([s, e]) => e - s + 1 >= minSeg)
    if (!segs.length) continue
    const cov = segs.reduce((s, [a, b]) => s + (b - a + 1), 0)
    if (cov < minCov) continue
    colXs.push(x)
    colSegs.set(x, segs)
  }
  const bands = clusterAxis(colXs, 3).map(({ lo, hi, mid }) => {
    const all = []
    for (let x = lo; x <= hi; x++) all.push(...(colSegs.get(x) ?? []))
    const segs = mergeRanges(all, 20)
    let y0 = Infinity
    let y1 = -Infinity
    for (const [s, e] of segs) {
      y0 = Math.min(y0, s)
      y1 = Math.max(y1, e)
    }
    return { x: mid, y0, y1, segs, x0: lo, x1: hi }
  })
  // Если H-стены известны — оставить V, чьи концы рядом с H (несущая сетка)
  if (hWallYs.length >= 2) {
    const tol = 14
    return bands.filter((b) => {
      const touchLo = hWallYs.some((hy) => Math.abs(b.y0 - hy) <= tol)
      const touchHi = hWallYs.some((hy) => Math.abs(b.y1 - hy) <= tol)
      // Несущая: оба конца у H, либо один конец у H и длина большая
      if (touchLo && touchHi) return true
      if ((touchLo || touchHi) && b.y1 - b.y0 >= h * 0.4) return true
      // Внешние стены (у краёв кадра по X) — всегда
      if (b.x <= 40 || b.x >= w - 40) return true
      return false
    })
  }
  return bands
}

/** Кластеризация 1D координат с зазором maxGap. */
function clusterAxis(vals, maxGap) {
  if (!vals.length) return []
  const sorted = [...vals].sort((a, b) => a - b)
  const out = []
  let lo = sorted[0]
  let hi = sorted[0]
  for (const v of sorted.slice(1)) {
    if (v - hi <= maxGap) hi = v
    else {
      out.push({ lo, hi, mid: Math.round((lo + hi) / 2) })
      lo = hi = v
    }
  }
  out.push({ lo, hi, mid: Math.round((lo + hi) / 2) })
  return out
}

/**
 * Маска стен: пиксели вблизи мажорных H/V линий, где есть тёмное.
 * Мебель вне линий стен не попадает → комнаты не рвутся.
 */
function buildWallMask(bin, w, h, hWalls, vWalls) {
  const mask = new Uint8Array(w * h)
  for (const band of hWalls) {
    const y0 = Math.max(0, band.y0 - 1)
    const y1 = Math.min(h - 1, band.y1 + 1)
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < w; x++) {
        // Расширить полосу: если в ±3px по Y есть тёмное — это стена
        let dark = false
        for (let dy = -3; dy <= 3; dy++) {
          const yy = band.y + dy
          if (yy >= 0 && yy < h && bin[yy * w + x]) {
            dark = true
            break
          }
        }
        if (dark) mask[y * w + x] = 1
      }
    }
  }
  for (const band of vWalls) {
    const x0 = Math.max(0, band.x0 - 1)
    const x1 = Math.min(w - 1, band.x1 + 1)
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < h; y++) {
        let dark = false
        for (let dx = -3; dx <= 3; dx++) {
          const xx = band.x + dx
          if (xx >= 0 && xx < w && bin[y * w + xx]) {
            dark = true
            break
          }
        }
        if (dark) mask[y * w + x] = 1
      }
    }
  }
  return mask
}

/**
 * Комнаты: flood-fill светлых областей внутри плана, не пересекая маску стен.
 * Компоненты, касающиеся края изображения, = фон (отбрасываются).
 */
function findRooms(wallMask, w, h, bounds) {
  const { x0, y0, x1, y1 } = bounds
  const visited = new Uint8Array(w * h)
  const rooms = []
  const stack = []

  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      if (wallMask[i] || visited[i]) continue
      stack.length = 0
      stack.push(i)
      visited[i] = 1
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      let size = 0
      let touchesBorder = false

      while (stack.length) {
        const p = stack.pop()
        size++
        const px = p % w
        const py = (p / w) | 0
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        // Касание края кадра = внешний фон
        if (px <= 1 || py <= 1 || px >= w - 2 || py >= h - 2) touchesBorder = true

        const nbs = [p - 1, p + 1, p - w, p + w]
        for (const nb of nbs) {
          if (nb < 0 || nb >= w * h) continue
          const nx = nb % w
          const ny = (nb / w) | 0
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue
          if (!inside(nx, ny)) continue
          if (wallMask[nb] || visited[nb]) continue
          visited[nb] = 1
          stack.push(nb)
        }
      }

      if (touchesBorder) continue
      const rw = maxX - minX + 1
      const rh = maxY - minY + 1
      if (size < 400 || rw < 18 || rh < 18) continue
      rooms.push({ x: minX, y: minY, w: rw, h: rh, size })
    }
  }
  return rooms
}

/** Притянуть значение к ближайшей линии из списка (если |d| ≤ tol). */
function snapTo(v, lines, tol = 10) {
  let best = v
  let bd = tol + 1
  for (const L of lines) {
    const d = Math.abs(v - L)
    if (d < bd) {
      bd = d
      best = L
    }
  }
  return bd <= tol ? best : v
}

/** Snap всех рёбер комнат к H/V линиям стен. */
function snapRooms(rooms, hLines, vLines) {
  return rooms.map((r) => {
    const x0 = snapTo(r.x, vLines, 12)
    const y0 = snapTo(r.y, hLines, 12)
    const x1 = snapTo(r.x + r.w, vLines, 12)
    const y1 = snapTo(r.y + r.h, hLines, 12)
    const w = Math.max(16, x1 - x0)
    const h = Math.max(16, y1 - y0)
    return { x: x0, y: y0, w, h, size: r.size }
  })
}

/**
 * Обрезать комнаты по ВНЕШНЕМУ контуру (не по внутренним стенам).
 * Для L-плана: в зоне правого крыла нижняя H-стена выше, чем у корпуса.
 */
function clipRoomsToWallSpans(rooms, hWalls, vWalls = []) {
  return rooms.map((r) => {
    let { x, y, w, h } = r
    const xMid = x + w / 2
    // Все H-стены, покрывающие центр комнаты по X
    const covering = hWalls.filter((b) => xMid >= b.x0 - 10 && xMid <= b.x1 + 10)
    if (covering.length >= 2) {
      const topY = Math.min(...covering.map((b) => b.y))
      const botY = Math.max(...covering.map((b) => b.y))
      // Если комната вылезает за внешний низ — обрезать
      if (y + h > botY + 6) h = Math.max(16, botY - y)
      // Если вылезает за внешний верх
      if (y < topY - 6) {
        h = y + h - topY
        y = topY
      }
    }
    // Доп.: правая внешняя V-стена короче (крыло) — y1 стены = низ крыла
    const rightV = vWalls
      .filter((v) => Math.abs(v.x - (x + w)) <= 10)
      .sort((a, b) => a.y1 - b.y1)[0]
    if (rightV && rightV.y1 < y + h - 10 && rightV.y1 > y + 40) {
      // Только если нет H-стены ниже rightV.y1, покрывающей xMid
      const lowerH = hWalls.some(
        (b) => b.y > rightV.y1 + 10 && xMid >= b.x0 - 10 && xMid <= b.x1 + 10,
      )
      if (!lowerH) h = Math.max(16, rightV.y1 - y)
    }
    if (h < 16 || w < 16) return r
    return { ...r, x, y, w, h }
  })
}

/** Убрать дубликаты/вложенные комнаты после snap. */
function dedupeRooms(rooms) {
  const sorted = [...rooms].sort((a, b) => b.w * b.h - a.w * a.h)
  const keep = []
  for (const r of sorted) {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    // Центр внутри уже принятой комнаты → вложенная, пропуск
    if (keep.some((k) => cx >= k.x && cx <= k.x + k.w && cy >= k.y && cy <= k.y + k.h)) continue
    // Почти совпадает с уже принятой
    if (
      keep.some(
        (k) =>
          Math.abs(k.x - r.x) <= 4 &&
          Math.abs(k.y - r.y) <= 4 &&
          Math.abs(k.w - r.w) <= 8 &&
          Math.abs(k.h - r.h) <= 8,
      )
    )
      continue
    keep.push(r)
  }
  return keep.sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * Проёмы на рёбрах комнат.
 * - Ребро на периметре здания → окна
 * - Общее ребро двух комнат → двери
 * Сканируем тонкую полосу ±3px вдоль ребра.
 */
function findOpeningsOnRoomEdges(bin, w, h, rooms, bounds) {
  const windows = []
  const doors = []
  const { x0, y0, x1, y1 } = bounds
  const outerTol = 10
  const seen = new Set()

  const pushUnique = (list, key, item) => {
    if (seen.has(key)) return
    seen.add(key)
    list.push(item)
  }

  // Горизонтальные рёбра каждой комнаты
  for (const r of rooms) {
    for (const side of ['top', 'bottom']) {
      const cy = side === 'top' ? r.y : r.y + r.h
      const xA = r.x + 6
      const xB = r.x + r.w - 6
      if (xB <= xA) continue
      const isOuter = Math.abs(cy - y0) <= outerTol || Math.abs(cy - y1) <= outerTol
      // Сосед через это ребро?
      const neighbor = rooms.find(
        (o) =>
          o !== r &&
          Math.abs((side === 'top' ? o.y + o.h : o.y) - cy) <= 4 &&
          !(o.x + o.w <= r.x + 4 || o.x >= r.x + r.w - 4),
      )
      const ops = scanHEdge(bin, w, h, cy, xA, xB)
      for (const op of ops) {
        if (isOuter && op.w >= 6 && op.w <= 48) {
          pushUnique(
            windows,
            `w-h-${Math.round(op.x / 4)}-${cy}`,
            { x: op.x, y: cy, w: op.w, side: Math.abs(cy - y0) <= outerTol ? 'top' : 'bottom' },
          )
        } else if (!isOuter && neighbor && op.w >= 6 && op.w <= 34) {
          pushUnique(
            doors,
            `d-h-${Math.round(op.x / 4)}-${cy}`,
            { x: op.x, y: cy, w: op.w, side: 'bottom' },
          )
        }
      }
    }
    // Вертикальные рёбра
    for (const side of ['left', 'right']) {
      const cx = side === 'left' ? r.x : r.x + r.w
      const yA = r.y + 6
      const yB = r.y + r.h - 6
      if (yB <= yA) continue
      const isOuter = Math.abs(cx - x0) <= outerTol || Math.abs(cx - x1) <= outerTol
      const neighbor = rooms.find(
        (o) =>
          o !== r &&
          Math.abs((side === 'left' ? o.x + o.w : o.x) - cx) <= 4 &&
          !(o.y + o.h <= r.y + 4 || o.y >= r.y + r.h - 4),
      )
      const ops = scanVEdge(bin, w, h, cx, yA, yB)
      for (const op of ops) {
        if (isOuter && op.h >= 6 && op.h <= 48) {
          pushUnique(
            windows,
            `w-v-${cx}-${Math.round(op.y / 4)}`,
            { x: cx, y: op.y, w: op.h, side: Math.abs(cx - x0) <= outerTol ? 'left' : 'right' },
          )
        } else if (!isOuter && neighbor && op.h >= 6 && op.h <= 34) {
          pushUnique(
            doors,
            `d-v-${cx}-${Math.round(op.y / 4)}`,
            { x: cx, y: op.y, w: op.h, side: 'right' },
          )
        }
      }
    }
  }
  return { windows, doors }
}

/** Проёмы на горизонтальном ребре y=cy, x ∈ [xA,xB]. */
function scanHEdge(bin, w, h, cy, xA, xB) {
  const y0 = Math.max(0, cy - 3)
  const y1 = Math.min(h - 1, cy + 3)
  const bandH = y1 - y0 + 1
  const prof = []
  for (let x = Math.floor(xA); x <= Math.ceil(xB); x++) {
    let dark = 0
    for (let y = y0; y <= y1; y++) dark += bin[y * w + x]
    prof.push(dark / bandH < 0.38 ? 1 : 0)
  }
  return clusters(prof, 1, 6).map(([s, e]) => ({
    x: Math.floor(xA) + (s + e) / 2,
    w: e - s + 1,
  }))
}

/** Проёмы на вертикальном ребре x=cx, y ∈ [yA,yB]. */
function scanVEdge(bin, w, h, cx, yA, yB) {
  const x0 = Math.max(0, cx - 3)
  const x1 = Math.min(w - 1, cx + 3)
  const bandW = x1 - x0 + 1
  const prof = []
  for (let y = Math.floor(yA); y <= Math.ceil(yB); y++) {
    let dark = 0
    for (let x = x0; x <= x1; x++) dark += bin[y * w + x]
    prof.push(dark / bandW < 0.38 ? 1 : 0)
  }
  return clusters(prof, 1, 6).map(([s, e]) => ({
    y: Math.floor(yA) + (s + e) / 2,
    h: e - s + 1,
  }))
}

/**
 * Связные компоненты бинарной маски (4-связность).
 * @returns {Array<{x,y,w,h,size}>}
 */
function connectedComponents(bin, w, h, minSize) {
  const visited = new Uint8Array(w * h)
  const comps = []
  const stack = []
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || visited[i]) continue
    stack.push(i)
    visited[i] = 1
    let minX = i % w
    let maxX = minX
    let minY = (i / w) | 0
    let maxY = minY
    let size = 0
    while (stack.length) {
      const p = stack.pop()
      size++
      const px = p % w
      const py = (p / w) | 0
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      for (const nb of [p - 1, p + 1, p - w, p + w]) {
        if (nb < 0 || nb >= w * h) continue
        const nx = nb % w
        const ny = (nb / w) | 0
        if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue
        if (bin[nb] && !visited[nb]) {
          visited[nb] = 1
          stack.push(nb)
        }
      }
    }
    if (size >= minSize) comps.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, size })
  }
  return comps
}

/**
 * Лестница: зона с ≥5 параллельными короткими горизонтальными ступенями
 * равного шага + вертикальная направляющая.
 */
function findStairs(bin, w, h, bounds, rooms) {
  // Ищем в узких высоких комнатах (шахта)
  const candidates = rooms.filter((r) => r.h >= 80 && r.w <= 70 && r.h / r.w >= 1.5)
  let best = null

  const searchZones = candidates.length
    ? candidates
    : [{ x: bounds.x0 + 20, y: bounds.y0 + 20, w: bounds.x1 - bounds.x0 - 40, h: bounds.y1 - bounds.y0 - 40 }]

  for (const zone of searchZones) {
    // Ступени — только ВНУТРИ комнаты, не на её верхней/нижней стене
    const yStart = zone.y + 8
    const yEnd = zone.y + zone.h - 8
    const treads = []
    for (let y = yStart; y < yEnd; y++) {
      const row = []
      for (let x = zone.x + 2; x < zone.x + zone.w - 2; x++) row.push(bin[y * w + x])
      for (const [s, e] of clusters(row, 1, 10)) {
        const len = e - s + 1
        if (len >= 12 && len <= 40) treads.push({ y, x: zone.x + 2 + s, len })
      }
    }
    if (treads.length < 5) continue

    treads.sort((a, b) => a.x - b.x || a.y - b.y)
    const groups = []
    for (const t of treads) {
      const g = groups.find((g) => Math.abs(g.x - t.x) <= 8)
      if (g) {
        g.items.push(t)
        g.x = (g.x * (g.items.length - 1) + t.x) / g.items.length
      } else groups.push({ x: t.x, items: [t] })
    }
    for (const g of groups) {
      if (g.items.length < 5) continue
      const ys = g.items.map((t) => t.y).sort((a, b) => a - b)
      const uniq = [ys[0]]
      for (const y of ys.slice(1)) {
        if (y - uniq[uniq.length - 1] > 3) uniq.push(y)
      }
      if (uniq.length < 5) continue
      const gaps = []
      for (let i = 1; i < uniq.length; i++) gaps.push(uniq[i] - uniq[i - 1])
      gaps.sort((a, b) => a - b)
      const step = gaps[Math.floor(gaps.length / 2)]
      if (step < 6 || step > 24) continue
      // Оставить только ступени с шагом ≈ median (отбросить стены)
      const filtered = [uniq[0]]
      for (let i = 1; i < uniq.length; i++) {
        const g = uniq[i] - filtered[filtered.length - 1]
        if (Math.abs(g - step) <= 5 || (g >= step * 0.6 && g <= step * 2.2)) {
          // если большой пропуск — всё равно добавить, но не чаще чем step*2
          if (g <= step * 2.5) filtered.push(uniq[i])
        }
      }
      if (filtered.length < 5) continue
      const okGaps = []
      for (let i = 1; i < filtered.length; i++) okGaps.push(filtered[i] - filtered[i - 1])
      const ok = okGaps.filter((g) => Math.abs(g - step) <= 5).length
      if (ok < filtered.length * 0.45) continue
      const avgLen = Math.round(g.items.reduce((s, t) => s + t.len, 0) / g.items.length)
      const score = filtered.length * 10 + ok
      if (!best || score > best.score) {
        best = {
          score,
          x: Math.round(g.x),
          y: filtered[0],
          len: avgLen,
          step,
          count: filtered.length,
          treads: filtered.map((y) => ({ y, x: Math.round(g.x), len: avgLen })),
        }
      }
    }
  }
  if (!best) return null
  return {
    x: best.x,
    y: best.y,
    len: best.len,
    step: best.step,
    count: best.count,
    treads: best.treads,
  }
}

/**
 * Фигуры внутри комнаты (тёмные компоненты, не стены).
 * wallMask — чтобы не брать куски стен.
 */
function findBlobsInRoom(bin, wallMask, w, h, room) {
  const local = new Uint8Array(w * h)
  const x0 = room.x + 3
  const y0 = room.y + 3
  const x1 = room.x + room.w - 3
  const y1 = room.y + room.h - 3
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x
      if (bin[i] && !wallMask[i]) local[i] = 1
    }
  }
  return connectedComponents(local, w, h, 12).filter((c) => {
    // Не на всю комнату
    if (c.w > room.w * 0.85 && c.h > room.h * 0.85) return false
    if (c.w > room.w - 6 || c.h > room.h - 6) return false
    return c.size <= 900
  })
}

/**
 * Классификация блоба: toilet / sink / table / chair / counter.
 * Унитаз: компактный овал 8..22px у стены.
 * Стол: крупнее, прямоугольный.
 */
function classifyBlob(c, room) {
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  const maxSide = Math.max(c.w, c.h)
  const minSide = Math.min(c.w, c.h)
  const ratio = c.w / Math.max(1, c.h)
  const fill = c.size / Math.max(1, c.w * c.h)
  const nearWall =
    cx - room.x <= 14 ||
    room.x + room.w - cx <= 14 ||
    cy - room.y <= 14 ||
    room.y + room.h - cy <= 14

  // Сантехника — плотные фигуры у стены, не меньше ~7px
  if (nearWall && maxSide <= 24 && minSide >= 6 && c.size >= 30 && fill > 0.4) {
    // Раковина: вытянутая вдоль стены
    if ((ratio >= 1.5 || ratio <= 0.65) && maxSide <= 22) {
      return { type: 'sink', x: cx, y: cy, w: Math.max(c.w, 10), h: Math.max(c.h, 8) }
    }
    // Унитаз: овал/квадрат 7..20px
    if (maxSide <= 20 && maxSide >= 7 && fill > 0.42) {
      return { type: 'toilet', x: cx, y: cy, w: Math.max(c.w, 10), h: Math.max(c.h, 10) }
    }
  }

  // Мебель: отсечь «нити» (ступени) — min ≥ 5, size ≥ 35
  if (minSide < 5 || c.size < 35) return null
  if (maxSide < 10) return null
  // Кресло / компактный предмет
  if (maxSide <= 28 && fill > 0.3 && ratio >= 0.35 && ratio <= 2.8) {
    return { type: 'chair', x: cx, y: cy, w: Math.max(c.w, 12), h: Math.max(c.h, 12) }
  }
  // Круглый стол
  if (ratio >= 0.55 && ratio <= 1.8 && maxSide <= 50 && fill > 0.28) {
    return { type: 'table', x: cx, y: cy, w: c.w, h: c.h, r: Math.round(maxSide / 2) }
  }
  // Стойка / прямоугольный стол (не тоньше 6px — иначе мусор/фрагмент стены)
  if (maxSide >= 14 && minSide >= 6) {
    return {
      type: 'counter',
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      points: [
        [c.x, c.y],
        [c.x + c.w, c.y],
        [c.x + c.w, c.y + c.h],
        [c.x, c.y + c.h],
      ],
    }
  }
  return null
}

/**
 * Комнаты из цветной заливки (connected components).
 */
function findRoomsFromFill(fill, w, h, minSize = 600) {
  const comps = connectedComponents(fill, w, h, minSize)
  const imgArea = w * h
  return comps
    .filter((c) => {
      if (c.w < 18 || c.h < 14) return false
      // отбросить почти весь кадр (фон, ошибочно попавший в fill)
      if (c.size > imgArea * 0.45) return false
      if (c.w > w * 0.92 && c.h > h * 0.5) return false
      return true
    })
    .map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, size: c.size }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * Окна из светлого cyan на периметре; сантехника из насыщенного cyan внутри комнат.
 */
function findCyanFeatures(cyan, cyanFix, w, h, bounds, rooms) {
  const { x0, y0, x1, y1 } = bounds
  const outerTol = Math.max(16, Math.round(Math.min(w, h) * 0.028))
  const windows = []
  const sanitary = []

  const roomAt = (px, py) =>
    rooms.find((r) => px >= r.x + 3 && px <= r.x + r.w - 3 && py >= r.y + 3 && py <= r.y + r.h - 3)

  // --- Окна: светлый cyan, вытянутые, на периметре ---
  for (const c of connectedComponents(cyan, w, h, 18)) {
    if (c.size > 3000 || c.w > 160 || c.h > 160) continue
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2
    const nearTop = Math.abs(cy - y0) <= outerTol || c.y <= y0 + outerTol
    const nearBot = Math.abs(cy - y1) <= outerTol || c.y + c.h >= y1 - outerTol
    const nearLeft = Math.abs(cx - x0) <= outerTol || c.x <= x0 + outerTol
    const nearRight = Math.abs(cx - x1) <= outerTol || c.x + c.w >= x1 - outerTol
    if (!(nearTop || nearBot || nearLeft || nearRight)) continue
    const elongated = c.w >= c.h * 1.4 || c.h >= c.w * 1.4
    if (!elongated && c.size > 400) continue
    let side = 'top'
    let size = Math.max(c.w, c.h)
    if (c.w >= c.h * 1.15) {
      side = nearBot && !nearTop ? 'bottom' : 'top'
      size = c.w
    } else if (c.h >= c.w * 1.15) {
      side = nearRight && !nearLeft ? 'right' : 'left'
      size = c.h
    } else if (nearLeft) side = 'left'
    else if (nearRight) side = 'right'
    else if (nearBot) side = 'bottom'
    if (size >= 6 && size <= 120) windows.push({ x: cx, y: cy, w: size, side })
  }

  // --- Сантехника: насыщенный cyan ВНУТРИ комнаты (не на периметре здания) ---
  for (const c of connectedComponents(cyanFix, w, h, 20)) {
    if (c.size > 2500 || c.w > 80 || c.h > 80) continue
    if (Math.max(c.w, c.h) < 6) continue
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2
    // не окно на периметре здания
    if (
      Math.abs(cy - y0) <= outerTol ||
      Math.abs(cy - y1) <= outerTol ||
      Math.abs(cx - x0) <= outerTol ||
      Math.abs(cx - x1) <= outerTol
    ) {
      continue
    }
    const host = roomAt(cx, cy)
    if (!host) continue
    // только в относительно небольших комнатах (санузел/тамбур) или у стены
    const isSmallRoom = host.w <= 160 && host.h <= 180
    const dl = cx - host.x
    const dr = host.x + host.w - cx
    const dt = cy - host.y
    const db = host.y + host.h - cy
    const nearRoomWall = Math.min(dl, dr, dt, db) <= 28
    if (!isSmallRoom && !nearRoomWall) continue

    const m = Math.min(dl, dr, dt, db)
    let tankDir
    if (m === dl) tankDir = 'left'
    else if (m === dr) tankDir = 'right'
    else if (m === dt) tankDir = 'up'
    else tankDir = 'down'

    const ratio = c.w / Math.max(1, c.h)
    // раковина чаще вытянута; унитаз — ближе к квадрату/овалу
    const isSink = (ratio >= 1.5 || ratio <= 0.65) && Math.max(c.w, c.h) <= 40
    sanitary.push({
      type: isSink ? 'sink' : 'toilet',
      x: cx,
      y: cy,
      w: Math.max(c.w, 10),
      h: Math.max(c.h, 10),
      tankDir,
      dir: tankDir === 'left' || tankDir === 'right' ? tankDir : 'right',
    })
  }

  const dedupe = (list, tol = 12) => {
    const out = []
    for (const item of [...list].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!out.find((o) => Math.abs(o.x - item.x) < tol && Math.abs(o.y - item.y) < tol)) {
        out.push(item)
      }
    }
    return out
  }
  return { windows: dedupe(windows), sanitary: dedupe(sanitary, 14) }
}

/**
 * Разбить крупные комнаты явными внутренними стенами (не дробить мелко).
 */
function splitRoomsByInternalWalls(rooms, vWalls, hWalls) {
  let out = [...rooms]
  for (const vw of vWalls) {
    const next = []
    for (const r of out) {
      if (r.w < 100) {
        next.push(r)
        continue
      }
      if (vw.x <= r.x + 14 || vw.x >= r.x + r.w - 14) {
        next.push(r)
        continue
      }
      const y0 = vw.y0 ?? r.y
      const y1 = vw.y1 ?? r.y + r.h
      const yOverlap = Math.min(r.y + r.h, y1) - Math.max(r.y, y0)
      if (yOverlap < r.h * 0.55) {
        next.push(r)
        continue
      }
      const leftW = vw.x - r.x
      const rightW = r.x + r.w - vw.x
      if (leftW >= 40 && rightW >= 40) {
        next.push({ x: r.x, y: r.y, w: leftW, h: r.h, size: r.size })
        next.push({ x: vw.x, y: r.y, w: rightW, h: r.h, size: r.size })
      } else {
        next.push(r)
      }
    }
    out = next
  }
  for (const hw of hWalls) {
    const next = []
    for (const r of out) {
      if (r.h < 90) {
        next.push(r)
        continue
      }
      if (hw.y <= r.y + 14 || hw.y >= r.y + r.h - 14) {
        next.push(r)
        continue
      }
      const x0 = hw.x0 ?? r.x
      const x1 = hw.x1 ?? r.x + r.w
      const xOverlap = Math.min(r.x + r.w, x1) - Math.max(r.x, x0)
      if (xOverlap < r.w * 0.55) {
        next.push(r)
        continue
      }
      const topH = hw.y - r.y
      const botH = r.y + r.h - hw.y
      if (topH >= 32 && botH >= 32) {
        next.push({ x: r.x, y: r.y, w: r.w, h: topH, size: r.size })
        next.push({ x: r.x, y: hw.y, w: r.w, h: botH, size: r.size })
      } else {
        next.push(r)
      }
    }
    out = next
  }
  return out
}

/** Дедуп проёмов с близкими центрами. */
function dedupeOpenings(list) {
  const out = []
  const sorted = [...list].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
  for (const op of sorted) {
    const dup = out.find(
      (o) => Math.abs((o.x ?? 0) - (op.x ?? 0)) < 14 && Math.abs((o.y ?? 0) - (op.y ?? 0)) < 14,
    )
    if (!dup) out.push(op)
  }
  return out
}

/**
 * Двери у коридора: тёмные вертикальные полоски на верхней/нижней границе коридора
 * (стиль «крест-полоски» организации, make-stage.md §8.2).
 */
function findCorridorDoors(dark, w, h, rooms, corridor, bounds) {
  const doors = []
  const cy = corridor.y
  const ch = Math.max(corridor.h || 20, 16)
  const bands = [
    { y0: Math.max(0, Math.round(cy - ch / 2 - 24)), y1: Math.max(0, Math.round(cy - ch / 2 + 4)) },
    { y0: Math.min(h - 1, Math.round(cy + ch / 2 - 4)), y1: Math.min(h - 1, Math.round(cy + ch / 2 + 24)) },
  ]
  for (const band of bands) {
    if (band.y1 <= band.y0) continue
    const prof = new Array(w).fill(0)
    const bh = band.y1 - band.y0 + 1
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      let s = 0
      for (let y = band.y0; y <= band.y1; y++) s += dark[y * w + x]
      prof[x] = s / bh > 0.28 ? 1 : 0
    }
    for (const [s, e] of clusters(prof, 2, 3)) {
      const pw = e - s + 1
      if (pw < 3 || pw > 30) continue
      const px = (s + e) / 2
      if (px < bounds.x0 + 15 || px > bounds.x1 - 15) continue
      const nearRoom = rooms.some(
        (r) => px >= r.x - 6 && px <= r.x + r.w + 6 && !(r.y + r.h < band.y0 - 30 || r.y > band.y1 + 30),
      )
      if (!nearRoom) continue
      const yDoor = (band.y0 + band.y1) / 2
      doors.push({ x: px, y: yDoor, w: Math.max(pw, 8), side: 'bottom' })
    }
  }
  return doors
}

/**
 * Двери на общих гранях комнат: либо проём (мало wall), либо тёмная засечка (door tick).
 */
function findDoorsOnSharedEdges(wall, dark, w, h, rooms) {
  const doors = []
  const tol = 6
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]
      const b = rooms[j]
      const ax1 = a.x + a.w
      const ay1 = a.y + a.h
      const bx1 = b.x + b.w
      const by1 = b.y + b.h

      // вертикальная общая грань
      if (Math.abs(ax1 - b.x) <= tol && a.y < by1 - 8 && ay1 > b.y + 8) {
        const x = Math.round((ax1 + b.x) / 2)
        const y0 = Math.max(a.y, b.y) + 4
        const y1 = Math.min(ay1, by1) - 4
        for (const op of scanSharedV(wall, dark, w, h, x, y0, y1)) {
          doors.push({ x, y: op.y, w: op.h, side: 'right' })
        }
      }
      if (Math.abs(bx1 - a.x) <= tol && a.y < by1 - 8 && ay1 > b.y + 8) {
        const x = Math.round((bx1 + a.x) / 2)
        const y0 = Math.max(a.y, b.y) + 4
        const y1 = Math.min(ay1, by1) - 4
        for (const op of scanSharedV(wall, dark, w, h, x, y0, y1)) {
          doors.push({ x, y: op.y, w: op.h, side: 'left' })
        }
      }

      // горизонтальная общая грань
      if (Math.abs(ay1 - b.y) <= tol && a.x < bx1 - 8 && ax1 > b.x + 8) {
        const y = Math.round((ay1 + b.y) / 2)
        const x0 = Math.max(a.x, b.x) + 4
        const x1 = Math.min(ax1, bx1) - 4
        for (const op of scanSharedH(wall, dark, w, h, y, x0, x1)) {
          doors.push({ x: op.x, y, w: op.w, side: 'bottom' })
        }
      }
      if (Math.abs(by1 - a.y) <= tol && a.x < bx1 - 8 && ax1 > b.x + 8) {
        const y = Math.round((by1 + a.y) / 2)
        const x0 = Math.max(a.x, b.x) + 4
        const x1 = Math.min(ax1, bx1) - 4
        for (const op of scanSharedH(wall, dark, w, h, y, x0, x1)) {
          doors.push({ x: op.x, y, w: op.w, side: 'top' })
        }
      }
    }
  }
  return doors
}

function scanSharedV(wall, dark, w, h, x, y0, y1) {
  const xA = Math.max(0, x - 3)
  const xB = Math.min(w - 1, x + 3)
  const bw = xB - xA + 1
  const gapProf = []
  const tickProf = []
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    let wallSum = 0
    let darkSum = 0
    for (let xi = xA; xi <= xB; xi++) {
      wallSum += wall[y * w + xi]
      darkSum += dark[y * w + xi]
    }
    gapProf.push(wallSum / bw < 0.25 ? 1 : 0)
    tickProf.push(darkSum / bw > 0.4 ? 1 : 0)
  }
  const gaps = clusters(gapProf, 1, 5).map(([s, e]) => ({
    y: Math.floor(y0) + (s + e) / 2,
    h: e - s + 1,
  }))
  const ticks = clusters(tickProf, 1, 3).map(([s, e]) => ({
    y: Math.floor(y0) + (s + e) / 2,
    h: Math.max(8, e - s + 1),
  }))
  // предпочитаем короткие проёмы/засечки (двери), не всю грань
  return [...gaps, ...ticks].filter((op) => op.h >= 5 && op.h <= 36)
}

function scanSharedH(wall, dark, w, h, y, x0, x1) {
  const yA = Math.max(0, y - 3)
  const yB = Math.min(h - 1, y + 3)
  const bh = yB - yA + 1
  const gapProf = []
  const tickProf = []
  for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    let wallSum = 0
    let darkSum = 0
    for (let yi = yA; yi <= yB; yi++) {
      wallSum += wall[yi * w + x]
      darkSum += dark[yi * w + x]
    }
    gapProf.push(wallSum / bh < 0.25 ? 1 : 0)
    tickProf.push(darkSum / bh > 0.4 ? 1 : 0)
  }
  const gaps = clusters(gapProf, 1, 5).map(([s, e]) => ({
    x: Math.floor(x0) + (s + e) / 2,
    w: e - s + 1,
  }))
  const ticks = clusters(tickProf, 1, 3).map(([s, e]) => ({
    x: Math.floor(x0) + (s + e) / 2,
    w: Math.max(8, e - s + 1),
  }))
  return [...gaps, ...ticks].filter((op) => op.w >= 5 && op.w <= 36)
}

/**
 * Коридор: светлая нейтральная полоса между рядами заливки.
 */
function findCorridorBand(data, w, h, bounds, rooms) {
  // эвристика: самая широкая низкая комната
  const low = rooms.filter((r) => r.h <= Math.max(50, h * 0.12) && r.w >= w * 0.25)
  if (low.length) {
    const best = [...low].sort((a, b) => b.w - a.w)[0]
    return { y: best.y + best.h / 2, h: best.h }
  }
  // по пикселям: нейтральная светлая строка внутри плана
  const { x0, y0, x1, y1 } = bounds
  let best = null
  for (let y = y0 + 10; y < y1 - 10; y++) {
    let neut = 0
    let col = 0
    const len = x1 - x0 + 1
    for (let x = x0; x <= x1; x++) {
      const o = (y * w + x) * 4
      const r = data[o]
      const g = data[o + 1]
      const b = data[o + 2]
      const lum = (r + g + b) / 3
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      if (lum > 210 && lum < 245 && chroma < 14) neut++
      if (chroma >= 12 && lum > 200) col++
    }
    if (neut / len > 0.35 && col / len < 0.2) {
      if (best && y - best.y0 <= 2) best.y1 = y
      else best = { y0: y, y1: y }
    }
  }
  if (best && best.y1 - best.y0 + 1 >= 12) {
    return { y: (best.y0 + best.y1) / 2, h: best.y1 - best.y0 + 1 }
  }
  return null
}

/**
 * Собрать roomMeta + sanitary/furniture из ink-блобов.
 */
function collectDetails(binOrInk, wallMask, w, h, rooms, stairs) {
  const sanitary = []
  const furniture = []
  const roomMeta = rooms.map((r) => {
    const blobs = findBlobsInRoom(binOrInk, wallMask, w, h, r)
    const items = blobs.map((b) => classifyBlob(b, r)).filter(Boolean)
    const toilets = items.filter((i) => i.type === 'toilet')
    const sinks = items.filter((i) => i.type === 'sink')
    const furn = items.filter((i) => i.type !== 'toilet' && i.type !== 'sink')

    const isSmall = r.w <= 160 && r.h <= 160
    const isService = isSmall && toilets.length >= 1

    if (isService) {
      for (const t of toilets) sanitary.push(t)
      for (const s of sinks) sanitary.push(s)
    } else {
      for (const f of furn) furniture.push(f)
      for (const t of toilets) {
        if (Math.max(t.w, t.h) >= 12) furniture.push({ ...t, type: 'chair' })
      }
    }

    // Коридор помечаем позже (ровно один) — здесь только кандидат
    const isCorridor = false
    const isStairs = !!(
      stairs &&
      stairs.x >= r.x - 6 &&
      stairs.x <= r.x + r.w + 6 &&
      stairs.y >= r.y - 10 &&
      stairs.y <= r.y + r.h + 10
    )

    return { room: r, isService, isCorridor, isStairs }
  })

  // Ровно один коридор-кандидат в roomMeta
  {
    let best = -1
    let bestScore = 0
    roomMeta.forEach((m, i) => {
      const r = m.room
      if (m.isService || m.isStairs) return
      if (r.w >= 180 && r.h <= 100) {
        const score = r.w / Math.max(r.h, 1)
        if (score > bestScore) {
          bestScore = score
          best = i
        }
      }
    })
    if (best >= 0) roomMeta[best].isCorridor = true
  }

  return { sanitary, furniture, roomMeta }
}

function finalizeExtraction({
  x0,
  y0,
  x1,
  y1,
  hWalls,
  vWalls,
  rooms,
  windows,
  doors,
  stairs,
  sanitary,
  furniture,
  roomMeta,
  mode,
}) {
  const isStairDoor = (d) => {
    if (!stairs) return false
    const sx0 = stairs.x - 6
    const sx1 = stairs.x + stairs.len + 6
    const sy0 = stairs.y - 6
    const sy1 = stairs.y + stairs.count * stairs.step + 6
    return d.x >= sx0 && d.x <= sx1 && d.y >= sy0 && d.y <= sy1
  }

  let corridor = null
  const corrRooms = roomMeta.filter((m) => m.isCorridor)
  if (corrRooms.length) {
    const best = [...corrRooms].sort((a, b) => b.room.w - a.room.w)[0]
    corridor = { y: best.room.y + best.room.h / 2, h: best.room.h }
  }

  return {
    mode,
    bounds: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    walls: {
      horizontal: hWalls.map((b) => ({ y: b.y, x0: b.x0, x1: b.x1 })),
      vertical: vWalls.map((b) => ({ x: b.x, y0: b.y0, y1: b.y1 })),
    },
    rooms: rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    roomMeta,
    corridor,
    windows: windows.filter((op) => op.w >= 6 && op.w <= 120),
    doors: doors.filter((op) => op.w >= 6 && op.w <= 40 && !isStairDoor(op)),
    stairs,
    sanitary,
    furniture,
    awnings: [],
  }
}

/**
 * Цветной режим: заливки комнат + голубые окна + серые стены.
 */
function extractPlanColor(data, w, h, masks) {
  const { wall, fill, cyan, cyanFix, dark, ink } = masks

  // bounds по стенам или заливке
  let x0 = w
  let y0 = h
  let x1 = 0
  let y1 = 0
  let any = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (wall[i] || fill[i]) {
        any = true
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (!any) {
    throw new Error('План не найден: нет цветных стен/заливок.')
  }
  // небольшой pad
  x0 = Math.max(0, x0 - 2)
  y0 = Math.max(0, y0 - 2)
  x1 = Math.min(w - 1, x1 + 2)
  y1 = Math.min(h - 1, y1 + 2)
  const bounds = { x0, y0, x1, y1 }

  // Комнаты из заливки
  let rooms = findRoomsFromFill(fill, w, h, Math.max(500, Math.floor(w * h * 0.0004)))
  // отсечь полоски UI/подписей и крошечные «мебельные» заливки
  rooms = rooms.filter((r) => {
    // тонкая полоса на всю ширину/высоту — не комната
    if (r.h <= 28 && r.w > w * 0.5) return false
    if (r.w <= 28 && r.h > h * 0.5) return false
    if (r.w >= 30 && r.h >= 28) return true
    // узкий коридор (горизонтальная лента)
    if (r.w >= 100 && r.h >= 18) return true
    if (r.h >= 100 && r.w >= 20) return true
    return false
  })

  // Стены: slate + светлые + оранж (короткие стены верхнего ряда тоже)
  const hWalls = findMajorHWalls(wall, w, h)
  const vWalls = findMajorVWalls(
    wall,
    w,
    h,
    hWalls.map((b) => b.y),
  )

  // Разбить только явно крупные комнаты внутренними стенами
  rooms = splitRoomsByInternalWalls(rooms, vWalls, hWalls)

  const hLines = hWalls.length
    ? hWalls.map((b) => b.y)
    : [...new Set(rooms.flatMap((r) => [r.y, r.y + r.h]))]
  const vLines = vWalls.length
    ? vWalls.map((b) => b.x)
    : [...new Set(rooms.flatMap((r) => [r.x, r.x + r.w]))]

  // snap к стенам + одна безопасная сшивка + анти-наложения
  rooms = dedupeRooms(snapRooms(rooms, hLines, vLines))
  rooms = snapNeighborEdges(rooms, 28)
  rooms = removeOverlappingRooms(rooms)
  if (hWalls.length) rooms = clipRoomsToWallSpans(rooms, hWalls, vWalls)
  rooms = removeOverlappingRooms(rooms)

  if (!rooms.length) {
    throw new Error('План не найден: нет помещений с цветной заливкой.')
  }

  // bounds уточнить по комнатам
  x0 = Math.min(...rooms.map((r) => r.x))
  y0 = Math.min(...rooms.map((r) => r.y))
  x1 = Math.max(...rooms.map((r) => r.x + r.w))
  y1 = Math.max(...rooms.map((r) => r.y + r.h))
  bounds.x0 = x0
  bounds.y0 = y0
  bounds.x1 = x1
  bounds.y1 = y1

  // Cyan → окна (светлый, периметр) + сантехника (насыщенный, внутри)
  const cyanFeat = findCyanFeatures(cyan, cyanFix || cyan, w, h, bounds, rooms)
  let windows = cyanFeat.windows
  const cyanSanitary = cyanFeat.sanitary

  // проёмы по wall/ink на рёбрах
  const edgeWall = findOpeningsOnRoomEdges(wall, w, h, rooms, bounds)
  const edgeInk = findOpeningsOnRoomEdges(ink, w, h, rooms, bounds)
  if (windows.length < 3) {
    windows = [...windows, ...edgeWall.windows, ...edgeInk.windows]
  }
  // Двери
  let doors = [...edgeWall.doors, ...edgeInk.doors]
  doors = doors.concat(findDoorsOnSharedEdges(wall, dark, w, h, rooms))
  const corridor = findCorridorBand(data, w, h, bounds, rooms)
  if (corridor) {
    doors = doors.concat(findCorridorDoors(dark, w, h, rooms, corridor, bounds))
  }
  doors = dedupeOpenings(doors)

  const wallMask = buildWallMask(wall, w, h, hWalls, vWalls)
  const mask = hWalls.length && vWalls.length ? wallMask : wall

  const stairs = findStairs(ink, w, h, bounds, rooms)
  // мебель/тёмные блобы + cyan-сантехника
  const details = collectDetails(ink, mask, w, h, rooms, stairs)
  let { furniture, roomMeta } = details
  // cyan-сантехника приоритетнее (реальные позиции с чертежа)
  let sanitary = cyanSanitary.length ? cyanSanitary : details.sanitary

  // комнаты с ≥1 cyan-унитазом → service
  if (cyanSanitary.length) {
    for (const m of roomMeta) {
      const inside = cyanSanitary.filter(
        (s) =>
          s.x >= m.room.x &&
          s.x <= m.room.x + m.room.w &&
          s.y >= m.room.y &&
          s.y <= m.room.y + m.room.h,
      )
      if (inside.length >= 1) m.isService = true
    }
  }

  // Коридор: не плодить — collectDetails уже выбрал одного; corridor.y только уточняет
  if (corridor && !roomMeta.some((m) => m.isCorridor)) {
    let best = -1
    let bestD = Infinity
    roomMeta.forEach((m, i) => {
      if (m.isService) return
      const d = Math.abs(m.room.y + m.room.h / 2 - corridor.y)
      if (d < bestD && m.room.w >= 150 && m.room.h <= 110) {
        bestD = d
        best = i
      }
    })
    if (best >= 0) roomMeta[best].isCorridor = true
  }

  const outH = hWalls.length
    ? hWalls
    : hLines.map((y) => ({ y, x0, x1, y0: y, y1: y }))
  const outV = vWalls.length
    ? vWalls
    : vLines.map((x) => ({ x, y0, y1, segs: [[y0, y1]], x0: x, x1: x }))

  return finalizeExtraction({
    x0,
    y0,
    x1,
    y1,
    hWalls: outH,
    vWalls: outV,
    rooms,
    windows,
    doors,
    stairs,
    sanitary,
    furniture,
    roomMeta,
    mode: 'color',
  })
}

/**
 * Ч/б режим: линии стен на светлом фоне.
 */
function extractPlanBW(data, w, h) {
  const bin = toBinary(data, w, h)

  const hWalls = findMajorHWalls(bin, w, h)
  const vWalls = findMajorVWalls(
    bin,
    w,
    h,
    hWalls.map((b) => b.y),
  )
  if (!hWalls.length || !vWalls.length) {
    throw new Error(
      'План не найден: нет стен (горизонтальных/вертикальных линий). Проверьте, что чертёж — схема с линиями стен.',
    )
  }

  const x0 = Math.min(...vWalls.map((v) => v.x))
  const x1 = Math.max(...vWalls.map((v) => v.x))
  const y0 = Math.min(...hWalls.map((v) => v.y))
  const y1 = Math.max(...hWalls.map((v) => v.y))
  const bounds = { x0, y0, x1, y1 }

  const wallMask = buildWallMask(bin, w, h, hWalls, vWalls)
  let rooms = findRooms(wallMask, w, h, bounds)

  const hLines = hWalls.map((b) => b.y)
  const vLines = vWalls.map((b) => b.x)
  rooms = dedupeRooms(snapRooms(rooms, hLines, vLines))
  rooms = clipRoomsToWallSpans(rooms, hWalls, vWalls)

  if (!rooms.length) {
    throw new Error('План не найден: не удалось выделить комнаты между стенами.')
  }

  const { windows, doors } = findOpeningsOnRoomEdges(bin, w, h, rooms, { x0, y0, x1, y1 })
  const stairs = findStairs(bin, w, h, bounds, rooms)
  const { sanitary, furniture, roomMeta } = collectDetails(bin, wallMask, w, h, rooms, stairs)

  return finalizeExtraction({
    x0,
    y0,
    x1,
    y1,
    hWalls,
    vWalls,
    rooms,
    windows,
    doors,
    stairs,
    sanitary,
    furniture,
    roomMeta,
    mode: 'bw',
  })
}

/**
 * Главная функция: анализ чертежа (авто BW / Color).
 * @param {ImageData} imageData
 */
export function extractPlan(imageData) {
  const w = imageData.width
  const h = imageData.height
  const data = imageData.data
  const masks = buildColorMasks(data, w, h)

  if (masks.mode === 'color') {
    try {
      return extractPlanColor(data, w, h, masks)
    } catch (err) {
      // fallback на BW, если цветной разбор не удался
      try {
        const bw = extractPlanBW(data, w, h)
        bw.mode = 'bw-fallback'
        bw.colorError = err.message
        return bw
      } catch {
        throw err
      }
    }
  }
  return extractPlanBW(data, w, h)
}

/**
 * Вписать план в viewBox с полями и чуть уменьшенным масштабом,
 * чтобы чертёж целиком помещался и не упирался в края.
 * @returns {{ scale, ox, oy }}
 */
export function fitPlanTransform(bounds, viewW = 1000, viewH = 640) {
  // Широкие поля: контент не обрезается BuildingOutline/панелью
  const marginX = 48
  const marginY = 44
  const usableW = viewW - marginX * 2
  const usableH = viewH - marginY * 2
  // 0.86 — чуть меньше «впритык», запас по краям
  const scale = Math.min(usableW / bounds.w, usableH / bounds.h) * 0.86
  const ox = marginX + (usableW - bounds.w * scale) / 2 - bounds.x * scale
  const oy = marginY + (usableH - bounds.h * scale) / 2 - bounds.y * scale
  return { scale, ox, oy }
}

/**
 * Стянуть соседние комнаты к середине зазора (один проход, пары уникальны).
 * Не создаёт наложений: левая/верхняя растёт вправо/вниз, правая/нижняя сдвигается.
 */
function snapNeighborEdges(rooms, maxGap = 28) {
  const rs = rooms.map((r) => ({ ...r }))
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      let L = rs[i]
      let R = rs[j]
      // --- вертикальный зазор (L слева, R справа) ---
      if (L.x > R.x) {
        const t = L
        L = R
        R = t
      }
      const gapV = R.x - (L.x + L.w)
      const yOv = Math.min(L.y + L.h, R.y + R.h) - Math.max(L.y, R.y)
      if (gapV > 0 && gapV <= maxGap && yOv > 10) {
        const mid = Math.round(L.x + L.w + gapV / 2)
        const rRight = R.x + R.w
        L.w = Math.max(10, mid - L.x)
        R.x = mid
        R.w = Math.max(10, rRight - mid)
      }

      // --- горизонтальный зазор (T сверху, B снизу) ---
      let T = rs[i]
      let B = rs[j]
      if (T.y > B.y) {
        const t = T
        T = B
        B = t
      }
      const gapH = B.y - (T.y + T.h)
      const xOv = Math.min(T.x + T.w, B.x + B.w) - Math.max(T.x, B.x)
      if (gapH > 0 && gapH <= maxGap && xOv > 10) {
        const mid = Math.round(T.y + T.h + gapH / 2)
        const bBot = B.y + B.h
        T.h = Math.max(10, mid - T.y)
        B.y = mid
        B.h = Math.max(10, bBot - mid)
      }
    }
  }
  return rs.filter((r) => r.w >= 12 && r.h >= 12)
}

/** Убрать комнаты, сильно перекрывающие более крупную. */
function removeOverlappingRooms(rooms) {
  const sorted = [...rooms].sort((a, b) => b.w * b.h - a.w * a.h)
  const keep = []
  for (const r of sorted) {
    const area = r.w * r.h
    let bad = false
    for (const k of keep) {
      const ix = Math.max(0, Math.min(r.x + r.w, k.x + k.w) - Math.max(r.x, k.x))
      const iy = Math.max(0, Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y))
      const inter = ix * iy
      if (inter > area * 0.35 || inter > k.w * k.h * 0.35) {
        bad = true
        break
      }
    }
    if (!bad) keep.push(r)
  }
  return keep.sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * Перенос в формат blueprintParser (сетка 1000×640).
 */
export function toRawBlueprint(extracted, scale = 1, ox = 0, oy = 0) {
  const tx = (v) => Math.round(ox + v * scale)
  const ty = (v) => Math.round(oy + v * scale)
  const tw = (v) => Math.max(1, Math.round(v * scale))

  const meta = extracted.roomMeta ?? extracted.rooms.map((r) => ({ room: r }))

  let rooms = meta.map((m, i) => {
    const r = m.room ?? extracted.rooms[i]
    let type = 'office'
    if (m.isStairs) type = 'service'
    else if (m.isService) type = 'service'
    else if (m.isCorridor) type = 'corridor'
    return {
      name: '',
      type,
      x: tx(r.x),
      y: ty(r.y),
      w: tw(r.w),
      h: tw(r.h),
      doors: [],
      windows: [],
      features: [],
    }
  })

  // Стянуть зазоры один раз + убрать наложения
  rooms = snapNeighborEdges(rooms, 24)
  rooms = removeOverlappingRooms(rooms)

  // Ровно ОДИН коридор: самая широкая низкая лента
  {
    let best = -1
    let bestScore = 0
    rooms.forEach((r, i) => {
      if (r.type === 'service') return
      if (r.w >= 180 && r.h <= 110) {
        const score = r.w / Math.max(r.h, 1)
        if (score > bestScore) {
          bestScore = score
          best = i
        }
      }
    })
    // сбросить ошибочные corridor
    for (const r of rooms) {
      if (r.type === 'corridor') r.type = 'office'
    }
    if (best >= 0) rooms[best].type = 'corridor'
    else if (extracted.corridor) {
      const cy = ty(extracted.corridor.y)
      let bi = -1
      let bd = Infinity
      rooms.forEach((r, i) => {
        const d = Math.abs(r.y + r.h / 2 - cy)
        if (d < bd && r.w >= 150 && r.h <= 120) {
          bd = d
          bi = i
        }
      })
      if (bi >= 0) rooms[bi].type = 'corridor'
    }
  }

  const roomAtImg = (px, py) => {
    const idx = extracted.rooms.findIndex(
      (r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h,
    )
    return idx >= 0 ? rooms[idx] : null
  }

  /** Привязка окна к периметру комнаты (с запасом — cyan часто на стене снаружи заливки). */
  const attachWindow = (op) => {
    const tol = 28
    let best = null
    let bestSide = op.side
    let bestD = Infinity
    for (let i = 0; i < extracted.rooms.length; i++) {
      const r = extracted.rooms[i]
      const room = rooms[i]
      const xOk = op.x >= r.x - tol && op.x <= r.x + r.w + tol
      const yOk = op.y >= r.y - tol && op.y <= r.y + r.h + tol
      if (!xOk && !yOk) continue
      const candidates = [
        { side: 'top', d: Math.abs(op.y - r.y), ok: xOk && Math.abs(op.y - r.y) <= tol },
        { side: 'bottom', d: Math.abs(op.y - (r.y + r.h)), ok: xOk && Math.abs(op.y - (r.y + r.h)) <= tol },
        { side: 'left', d: Math.abs(op.x - r.x), ok: yOk && Math.abs(op.x - r.x) <= tol },
        { side: 'right', d: Math.abs(op.x - (r.x + r.w)), ok: yOk && Math.abs(op.x - (r.x + r.w)) <= tol },
      ]
      for (const c of candidates) {
        if (c.ok && c.d < bestD) {
          bestD = c.d
          best = room
          bestSide = c.side
        }
      }
    }
    // fallback: комната, содержащая точку / ближайшая по центру
    if (!best) {
      let bestIdx = -1
      let bestDist = Infinity
      for (let i = 0; i < extracted.rooms.length; i++) {
        const r = extracted.rooms[i]
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        const dist = Math.abs(cx - op.x) + Math.abs(cy - op.y)
        // точка рядом с комнатой
        const near =
          op.x >= r.x - tol &&
          op.x <= r.x + r.w + tol &&
          op.y >= r.y - tol &&
          op.y <= r.y + r.h + tol
        if (near && dist < bestDist) {
          bestDist = dist
          bestIdx = i
        }
      }
      if (bestIdx < 0) return
      best = rooms[bestIdx]
      const r = extracted.rooms[bestIdx]
      const dists = [
        { side: 'top', d: Math.abs(op.y - r.y) },
        { side: 'bottom', d: Math.abs(op.y - (r.y + r.h)) },
        { side: 'left', d: Math.abs(op.x - r.x) },
        { side: 'right', d: Math.abs(op.x - (r.x + r.w)) },
      ]
      dists.sort((a, b) => a.d - b.d)
      bestSide = dists[0].side
    }
    let px = tx(op.x)
    let py = ty(op.y)
    if (bestSide === 'top') py = best.y
    else if (bestSide === 'bottom') py = best.y + best.h
    else if (bestSide === 'left') px = best.x
    else px = best.x + best.w
    // размер окна: для цветных cyan-пятен scale мягче
    const base = op.w >= 20 ? op.w : op.w * 2.5
    best.windows.push({
      x: px,
      y: py,
      w: Math.max(36, tw(base)),
      side: bestSide,
      blue: true,
    })
  }

  const attachDoor = (op) => {
    const tol = 10
    let best = null
    let bestSide = op.side
    let bestD = Infinity
    for (let i = 0; i < extracted.rooms.length; i++) {
      const r = extracted.rooms[i]
      const room = rooms[i]
      const checks = [
        { side: 'top', d: Math.abs(op.y - r.y), ok: op.x >= r.x - 4 && op.x <= r.x + r.w + 4 },
        {
          side: 'bottom',
          d: Math.abs(op.y - (r.y + r.h)),
          ok: op.x >= r.x - 4 && op.x <= r.x + r.w + 4,
        },
        { side: 'left', d: Math.abs(op.x - r.x), ok: op.y >= r.y - 4 && op.y <= r.y + r.h + 4 },
        {
          side: 'right',
          d: Math.abs(op.x - (r.x + r.w)),
          ok: op.y >= r.y - 4 && op.y <= r.y + r.h + 4,
        },
      ]
      for (const c of checks) {
        if (c.ok && c.d <= tol && c.d < bestD) {
          bestD = c.d
          best = room
          bestSide = c.side
        }
      }
    }
    if (!best) return
    let px = tx(op.x)
    let py = ty(op.y)
    if (bestSide === 'top') py = best.y
    else if (bestSide === 'bottom') py = best.y + best.h
    else if (bestSide === 'left') px = best.x
    else px = best.x + best.w
    best.doors.push({
      x: px,
      y: py,
      w: Math.max(18, tw(op.w)),
      side: bestSide,
      // Крест-полоски как на чертеже организации (make-stage.md §8.2)
      style: 'cross',
    })
  }

  for (const w of extracted.windows) attachWindow(w)
  for (const d of extracted.doors) attachDoor(d)

  // Сантехника
  for (const s of extracted.sanitary) {
    const room = roomAtImg(s.x, s.y)
    if (!room) continue
    room.type = 'service'
    // Ориентация унитаза: бачок к ближайшей стене
    const [ix, iy] = [s.x, s.y]
    const r0 = extracted.rooms.find(
      (r) => ix >= r.x && ix <= r.x + r.w && iy >= r.y && iy <= r.y + r.h,
    )
    let tankDir = 'right'
    if (r0) {
      const dl = ix - r0.x
      const dr = r0.x + r0.w - ix
      const dt = iy - r0.y
      const db = r0.y + r0.h - iy
      const m = Math.min(dl, dr, dt, db)
      if (m === dl) tankDir = 'left'
      else if (m === dr) tankDir = 'right'
      else if (m === dt) tankDir = 'up'
      else tankDir = 'down'
    }
    room.features.push({
      type: s.type,
      x: tx(s.x),
      y: ty(s.y),
      w: Math.max(12, tw(s.w * 1.4)),
      h: Math.max(10, tw(s.h * 1.4)),
      tankDir,
      dir: tankDir === 'left' ? 'left' : 'right',
    })
  }

  // Мебель
  for (const f of extracted.furniture) {
    const room = roomAtImg(f.x + (f.w ?? 0) / 2, f.y + (f.h ?? 0) / 2) ?? roomAtImg(f.x, f.y)
    if (!room || room.type === 'service') continue
    if (f.type === 'counter' && f.points) {
      room.features.push({
        type: 'counter',
        points: f.points.map(([x, y]) => [tx(x), ty(y)]),
      })
    } else if (f.type === 'table') {
      room.features.push({
        type: 'table',
        x: tx(f.x),
        y: ty(f.y),
        r: Math.max(8, tw(f.r ?? Math.max(f.w, f.h) / 2)),
        w: tw(f.w),
        h: tw(f.h),
      })
    } else if (f.type === 'chair') {
      room.features.push({
        type: 'chair',
        x: tx(f.x),
        y: ty(f.y),
        w: Math.max(12, tw(f.w)),
        h: Math.max(12, tw(f.h)),
      })
    }
  }

  // Лестница
  if (extracted.stairs) {
    const s = extracted.stairs
    const room = roomAtImg(s.x + s.len / 2, s.y + 10)
    const entry = {
      type: 'stairs',
      x: tx(s.x),
      y: ty(s.y),
      step: Math.max(8, tw(s.step)),
      count: s.count,
      len: Math.max(16, tw(s.len)),
      dir: 'right',
    }
    if (room) {
      room.features.push(entry)
      room.type = 'service'
    } else if (rooms[0]) {
      rooms[0].features.push(entry)
    }
  }

  // Внутренние стены — ВСЕ общие грани (коридор ↔ комнаты, комнаты ↔ комнаты)
  const WALL = 10
  const mkPart = (x1, y1, x2, y2) => ({
    type: 'partition',
    points: [
      [x1, y1],
      [x2, y2],
    ],
    strokeWidth: 7,
  })
  const addPart = (host, x1, y1, x2, y2) => {
    if (Math.hypot(x2 - x1, y2 - y1) < 8) return
    // не дублировать почти ту же линию
    const exists = host.features.some((f) => {
      if (f.type !== 'partition' || !f.points?.[1]) return false
      const [[ax, ay], [bx, by]] = f.points
      return (
        Math.abs(ax - x1) <= 3 &&
        Math.abs(ay - y1) <= 3 &&
        Math.abs(bx - x2) <= 3 &&
        Math.abs(by - y2) <= 3
      )
    })
    if (!exists) host.features.push(mkPart(x1, y1, x2, y2))
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]
      const b = rooms[j]
      const ax1 = a.x + a.w
      const ay1 = a.y + a.h
      const bx1 = b.x + b.w
      const by1 = b.y + b.h
      // Вертикальная общая грань
      if (Math.abs(ax1 - b.x) <= WALL && a.y < by1 - 4 && ay1 > b.y + 4) {
        const y0 = Math.max(a.y, b.y)
        const y1 = Math.min(ay1, by1)
        const mx = Math.round((ax1 + b.x) / 2)
        addPart(a, mx, y0, mx, y1)
      } else if (Math.abs(bx1 - a.x) <= WALL && a.y < by1 - 4 && ay1 > b.y + 4) {
        const y0 = Math.max(a.y, b.y)
        const y1 = Math.min(ay1, by1)
        const mx = Math.round((bx1 + a.x) / 2)
        addPart(a, mx, y0, mx, y1)
      }
      // Горизонтальная общая грань (коридор сверху/снизу)
      if (Math.abs(ay1 - b.y) <= WALL && a.x < bx1 - 4 && ax1 > b.x + 4) {
        const x0 = Math.max(a.x, b.x)
        const x1 = Math.min(ax1, bx1)
        const my = Math.round((ay1 + b.y) / 2)
        addPart(a, x0, my, x1, my)
      } else if (Math.abs(by1 - a.y) <= WALL && a.x < bx1 - 4 && ax1 > b.x + 4) {
        const x0 = Math.max(a.x, b.x)
        const x1 = Math.min(ax1, bx1)
        const my = Math.round((by1 + a.y) / 2)
        addPart(a, x0, my, x1, my)
      }
    }
  }

  // Коридор: принудительно полные стены по верху и низу ленты (если есть соседи)
  for (const corr of rooms.filter((r) => r.type === 'corridor')) {
    const topY = corr.y
    const botY = corr.y + corr.h
    const left = corr.x
    const right = corr.x + corr.w
    // верхняя линия коридора
    addPart(corr, left, topY, right, topY)
    // нижняя линия коридора
    addPart(corr, left, botY, right, botY)
    // торцы коридора, если нет комнаты сбоку
    const hasLeft = rooms.some(
      (r) => r !== corr && Math.abs(r.x + r.w - corr.x) <= WALL && r.y < botY - 4 && r.y + r.h > topY + 4,
    )
    const hasRight = rooms.some(
      (r) => r !== corr && Math.abs(r.x - (corr.x + corr.w)) <= WALL && r.y < botY - 4 && r.y + r.h > topY + 4,
    )
    if (!hasLeft) addPart(corr, left, topY, left, botY)
    if (!hasRight) addPart(corr, right, topY, right, botY)
  }

  return {
    name: 'Конвертер: план из чертежа',
    floors: [
      {
        level: 1,
        name: '1 этаж — из чертежа',
        bounds: [1000, 640],
        rooms,
        objects: [],
      },
    ],
  }
}
