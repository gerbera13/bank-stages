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
 * «Мягкие» чернила: стены + светло-серая обстановка.
 * Сантехника на ч/б чертежах рисуется тонким серым контуром (lum ≈ 130..200)
 * и в жёсткую бинаризацию не попадает — контур рвётся на куски.
 */
function toSoftInk(data, w, h) {
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const lum = (data[o] + data[o + 1] + data[o + 2]) / 3
    ink[i] = lum < 215 ? 1 : 0
  }
  return ink
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
function findMajorHWalls(bin, w, h, covFrac = 0.48) {
  const minCov = Math.max(60, Math.floor(w * covFrac))
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
function findMajorVWalls(bin, w, h, hWallYs = [], covFrac = 0.12) {
  // 12% высоты или ≥45px — ловит стены одного ряда комнат
  const minCov = Math.max(45, Math.floor(h * covFrac))
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
    // Плотность (как у H-стен): несущая стена ≈ сплошная линия.
    // Столбцы подписей («офис 7», «11,85 м²») после merge дают длинный,
    // но «дырявый» span — без этой проверки они становятся ложными стенами
    // и режут/съедают комнаты.
    let spanDark = 0
    let spanLen = 0
    for (const [s, e] of segs) {
      spanLen += e - s + 1
      for (let y = s; y <= e; y++) spanDark += col[y]
    }
    if (spanLen > 0 && spanDark / spanLen < 0.5) continue
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
 * Ширина дверного проёма в пикселях (≈0.9 м на плане этажа).
 * Разрывы у́же неё зашиваются в маске стен, окна и арки — нет.
 */
function doorGapPx(w, h) {
  return Math.max(12, Math.round(Math.min(w, h) * 0.08))
}

/**
 * Зашить дверные проёмы в маске стен.
 * Без этого flood-fill утекает через двери и склеивает соседние комнаты
 * (на демо-чертеже так пропадали «офис 7» и граница «офис 3 / офис 2»).
 * Зашиваются только ВНУТРЕННИЕ разрывы стены (с обеих сторон есть стена)
 * длиной ≤ maxGap — окна (шире) и открытые проходы остаются открытыми.
 */
function sealDoorGaps(bin, mask, w, h, hWalls, vWalls, maxGap) {
  // Сплошной кусок стены по обе стороны от разрыва — чтобы не «сшивать»
  // редкие пиксели подписей в несуществующую стену.
  const minSolid = 8
  // «Стена здесь есть» = чернил поперёк полосы не меньше, чем у самой стены.
  // Порог берём от ТИПИЧНОЙ толщины этой стены, а не от ширины полосы:
  // на чертежах стену часто рисуют двойной линией (две грани и пустота между),
  // и доля от ширины полосы для неё недостижима — зашивка дверей не срабатывала.
  const minThickness = 0.6

  /** Профиль присутствия стены вдоль полосы по её же типичной толщине */
  const wallProfile = (len, inkAt) => {
    const nonZero = []
    for (let i = 0; i < len; i++) if (inkAt[i] > 0) nonZero.push(inkAt[i])
    if (!nonZero.length) return new Uint8Array(len)
    nonZero.sort((a, b) => a - b)
    const typical = nonZero[Math.floor(nonZero.length * 0.6)]
    const need = Math.max(1, Math.round(typical * minThickness))
    const prof = new Uint8Array(len)
    for (let i = 0; i < len; i++) prof[i] = inkAt[i] >= need ? 1 : 0
    return prof
  }

  /**
   * @param {Uint8Array} prof — 1 = стена есть в этой позиции вдоль полосы
   * @param {number} lo,hi — реальный отрезок стены (вне его не зашиваем)
   * @param {(pos: number) => void} seal — закрасить позицию в маске
   */
  const sealProfile = (prof, lo, hi, seal) => {
    let i = lo
    while (i <= hi) {
      if (prof[i]) {
        i++
        continue
      }
      const s = i
      while (i <= hi && !prof[i]) i++
      const gap = i - s
      if (s <= lo || i > hi || gap > maxGap) continue
      let before = 0
      while (before < minSolid && prof[s - 1 - before]) before++
      let after = 0
      while (after < minSolid && prof[i + after]) after++
      if (before < minSolid || after < minSolid) continue
      for (let p = s; p < i; p++) seal(p)
    }
  }

  // Вертикальные стены: профиль по Y
  for (const band of vWalls) {
    const xa = Math.max(0, band.x0)
    const xb = Math.min(w - 1, band.x1)
    const inkAt = new Int32Array(h)
    for (let y = 0; y < h; y++) {
      let ink = 0
      for (let x = xa; x <= xb; x++) ink += bin[y * w + x]
      inkAt[y] = ink
    }
    const prof = wallProfile(h, inkAt)
    sealProfile(prof, Math.max(1, band.y0), Math.min(h - 2, band.y1), (y) => {
      for (let x = Math.max(0, xa - 1); x <= Math.min(w - 1, xb + 1); x++) mask[y * w + x] = 1
    })
  }

  // Горизонтальные стены: профиль по X
  for (const band of hWalls) {
    const ya = Math.max(0, band.y0)
    const yb = Math.min(h - 1, band.y1)
    const inkAt = new Int32Array(w)
    for (let x = 0; x < w; x++) {
      let ink = 0
      for (let y = ya; y <= yb; y++) ink += bin[y * w + x]
      inkAt[x] = ink
    }
    const prof = wallProfile(w, inkAt)
    sealProfile(prof, Math.max(1, band.x0), Math.min(w - 2, band.x1), (x) => {
      for (let y = Math.max(0, ya - 1); y <= Math.min(h - 1, yb + 1); y++) mask[y * w + x] = 1
    })
  }
  return mask
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
  return sealDoorGaps(bin, mask, w, h, hWalls, vWalls, doorGapPx(w, h))
}

/**
 * Короткие внутренние перегородки, которые не проходят порог мажорных стен:
 * стенка между кабинками санузла занимает ~10% ширины плана.
 * Ищем внутри уже найденной комнаты сплошную линию от края до края.
 *
 * @param {Array<{x,y,w,h}>} rooms — комнаты первого прохода
 * @returns {{ h: Array, v: Array }} полосы в формате мажорных стен
 */
function findPartitionWalls(bin, w, h, rooms, maxGap) {
  const hBands = []
  const vBands = []
  // Перегородка упирается в стены комнаты с обеих сторон, а её разрывы —
  // это двери. Строка подписи до стен не достаёт и в основном светлая,
  // направляющая лестницы обрывается, не дойдя до стен.
  const minFill = 0.5
  const endTol = 3

  /**
   * Проверить линию поперёк комнаты.
   * @returns {boolean} перегородка ли это
   */
  const isPartition = (get, from, to) => {
    const len = to - from + 1
    if (len < 12) return false
    let dark = 0
    for (let p = from; p <= to; p++) dark += get(p) ? 1 : 0
    if (dark / len < minFill) return false
    // упирается в обе стены комнаты
    let headOk = false
    let tailOk = false
    for (let d = 0; d <= endTol; d++) {
      if (get(from + d)) headOk = true
      if (get(to - d)) tailOk = true
    }
    if (!headOk || !tailOk) return false
    // все разрывы — не шире двери
    let gap = 0
    for (let p = from; p <= to; p++) {
      if (get(p)) gap = 0
      else if (++gap > maxGap) return false
    }
    return true
  }

  for (const r of rooms) {
    const xA = r.x + 3
    const xB = r.x + r.w - 3
    const yA = r.y + 3
    const yB = r.y + r.h - 3

    // Горизонтальная перегородка внутри комнаты
    const rows = []
    for (let y = r.y + 12; y <= r.y + r.h - 12; y++) {
      if (isPartition((x) => bin[y * w + x], xA, xB)) rows.push(y)
    }
    for (const { lo, hi, mid } of clusterAxis(rows, 2)) {
      if (hi - lo + 1 > maxGap) continue
      hBands.push({ y: mid, x0: r.x, x1: r.x + r.w, y0: lo, y1: hi })
    }

    // Вертикальная перегородка внутри комнаты
    const cols = []
    for (let x = r.x + 12; x <= r.x + r.w - 12; x++) {
      if (isPartition((y) => bin[y * w + x], yA, yB)) cols.push(x)
    }
    for (const { lo, hi, mid } of clusterAxis(cols, 2)) {
      if (hi - lo + 1 > maxGap) continue
      vBands.push({ x: mid, y0: r.y, y1: r.y + r.h, x0: lo, x1: hi })
    }
  }
  return { h: hBands, v: vBands }
}

/**
 * Контур связной области по её пикселям: рёбра граничных клеток сшиваются
 * в замкнутую ломаную. Пока по пикселям — со «ступеньками» на скосах,
 * их убирает simplifyPath.
 * @param {Uint8Array} mark — 1 на пикселях области
 * @returns {[number, number][] | null}
 */
function traceOutline(mark, w, h, box) {
  const at = (x, y) =>
    x < box.x0 || y < box.y0 || x > box.x1 || y > box.y1 ? 0 : mark[y * w + x]
  // Направленные рёбра: обход по часовой (ось Y вниз)
  const edges = new Map()
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (!at(x, y)) continue
      if (!at(x, y - 1)) edges.set(`${x},${y}`, [x, y, x + 1, y])
      if (!at(x + 1, y)) edges.set(`${x + 1},${y}`, [x + 1, y, x + 1, y + 1])
      if (!at(x, y + 1)) edges.set(`${x + 1},${y + 1}`, [x + 1, y + 1, x, y + 1])
      if (!at(x - 1, y)) edges.set(`${x},${y + 1}`, [x, y + 1, x, y])
    }
  }
  if (edges.size < 4) return null
  const startKey = [...edges.keys()].sort((a, b) => {
    const [ax, ay] = a.split(',').map(Number)
    const [bx, by] = b.split(',').map(Number)
    return ay - by || ax - bx
  })[0]
  const pts = []
  let key = startKey
  for (let guard = 0; guard <= edges.size; guard++) {
    const e = edges.get(key)
    if (!e) return null
    pts.push([e[0], e[1]])
    key = `${e[2]},${e[3]}`
    if (key === startKey) break
  }
  return pts.length >= 4 ? pts : null
}

/** Расстояние от точки до отрезка — для упрощения ломаной. */
function pointToSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Дуглас–Пекер для разомкнутой цепочки. */
function simplifyChain(pts, tol) {
  if (pts.length < 3) return pts
  let maxD = -1
  let idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegment(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]]
  const left = simplifyChain(pts.slice(0, idx + 1), tol)
  const right = simplifyChain(pts.slice(idx), tol)
  return [...left.slice(0, -1), ...right]
}

/**
 * Упростить замкнутый контур: пиксельные ступеньки → прямые стены и скосы.
 * Режем петлю на две цепочки по самым удалённым точкам, чтобы Дуглас–Пекер
 * не «срезал» её целиком.
 */
function simplifyPath(pts, tol) {
  if (pts.length < 5) return pts
  let a = 0
  let b = 0
  let best = -1
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1])
    if (d > best) {
      best = d
      b = i
    }
  }
  const first = simplifyChain(pts.slice(a, b + 1), tol)
  const second = simplifyChain([...pts.slice(b), pts[0]], tol)
  const out = [...first.slice(0, -1), ...second.slice(0, -1)]
  return out.length >= 4 ? out : pts
}

/**
 * Маска из ВСЕХ чернил, расширенная на `r` пикселей.
 * Расширение замыкает волосяные линии и двойные грани стен, чтобы flood-fill
 * не протекал между ними.
 */
function inkMask(bin, w, h, r) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue
      const y0 = Math.max(0, y - r)
      const y1 = Math.min(h - 1, y + r)
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r)
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) out[yy * w + xx] = 1
      }
    }
  }
  return out
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
  // Пиксели текущей компоненты — для обводки её настоящей формы.
  // Чистим только по её габаритам, поэтому переиспользуем один буфер.
  const mark = new Uint8Array(w * h)
  const cells = []

  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      if (wallMask[i] || visited[i]) continue
      stack.length = 0
      cells.length = 0
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
        mark[p] = 1
        cells.push(p)
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

      const rw = maxX - minX + 1
      const rh = maxY - minY + 1
      const keep = !touchesBorder && size >= 400 && rw >= 18 && rh >= 18
      if (keep) {
        // Настоящая форма комнаты: нужна для скошенных стен — прямоугольник
        // их срезает. Внутренняя логика по-прежнему работает по габаритам.
        const raw = traceOutline(mark, w, h, { x0: minX, y0: minY, x1: maxX, y1: maxY })
        // Допуск щедрый: убирает пиксельные ступеньки, дверные выемки и
        // касания подписей, оставляя настоящие скосы стен
        const tol = Math.max(4, Math.round(Math.min(rw, rh) * 0.12))
        const poly = raw ? simplifyPath(raw, tol) : null
        rooms.push({ x: minX, y: minY, w: rw, h: rh, size, poly })
      }
      for (const p of cells) mark[p] = 0
      if (!keep) continue
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
    return { x: x0, y: y0, w, h, size: r.size, poly: r.poly }
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

/**
 * Выбросить «комнаты»-полоски: нитка в 30px шириной на всю высоту плана —
 * это панель или скролл интерфейса, а не помещение. Такая полоска растягивает
 * габариты, и настоящий чертёж сжимается в узкую ленту.
 * Условия строгие (И тонкая, И сильно вытянутая), чтобы не задеть коридор.
 */
function dropSliverRooms(rooms) {
  if (rooms.length < 3) return rooms
  const x0 = Math.min(...rooms.map((r) => r.x))
  const y0 = Math.min(...rooms.map((r) => r.y))
  const x1 = Math.max(...rooms.map((r) => r.x + r.w))
  const y1 = Math.max(...rooms.map((r) => r.y + r.h))
  const thin = Math.max(12, Math.min(x1 - x0, y1 - y0) * 0.06)
  const kept = rooms.filter((r) => {
    const minSide = Math.min(r.w, r.h)
    const aspect = Math.max(r.w, r.h) / Math.max(1, minSide)
    return !(minSide < thin && aspect > 8)
  })
  // Отсеялось больше половины — гипотеза неверна, оставляем как было
  return kept.length >= Math.max(2, rooms.length * 0.5) ? kept : rooms
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
      // Сосед через это ребро?
      const neighbor = rooms.find(
        (o) =>
          o !== r &&
          Math.abs((side === 'top' ? o.y + o.h : o.y) - cy) <= 4 &&
          !(o.x + o.w <= r.x + 4 || o.x >= r.x + r.w - 4),
      )
      // Наружная стена — не только габарит плана: у Г-образного корпуса низ
      // крыла тоже периметр. Признак — за ребром нет комнаты.
      const isOuter =
        !neighbor || Math.abs(cy - y0) <= outerTol || Math.abs(cy - y1) <= outerTol
      const ops = scanHEdge(bin, w, h, cy, xA, xB)
      for (const op of ops) {
        if (isOuter && op.w >= 6 && op.w <= 48) {
          pushUnique(windows, `w-h-${Math.round(op.x / 4)}-${cy}`, {
            x: op.x,
            y: cy,
            w: op.w,
            side,
          })
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
      const neighbor = rooms.find(
        (o) =>
          o !== r &&
          Math.abs((side === 'left' ? o.x + o.w : o.x) - cx) <= 4 &&
          !(o.y + o.h <= r.y + 4 || o.y >= r.y + r.h - 4),
      )
      const isOuter =
        !neighbor || Math.abs(cx - x0) <= outerTol || Math.abs(cx - x1) <= outerTol
      const ops = scanVEdge(bin, w, h, cx, yA, yB)
      for (const op of ops) {
        if (isOuter && op.h >= 6 && op.h <= 48) {
          pushUnique(windows, `w-v-${cx}-${Math.round(op.y / 4)}`, {
            x: cx,
            y: op.y,
            w: op.h,
            side,
          })
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
 * Связные компоненты бинарной маски.
 * @param {boolean} diagonal — 8-связность: тонкий наклонный штрих (дуга
 *   раковины, овал унитаза) при 4-связности рвётся на куски по диагонали.
 * @returns {Array<{x,y,w,h,size}>}
 */
function connectedComponents(bin, w, h, minSize, diagonal = false) {
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
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          if (!diagonal && dx && dy) continue
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const nb = ny * w + nx
          if (bin[nb] && !visited[nb]) {
            visited[nb] = 1
            stack.push(nb)
          }
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
  const found = []

  const wholeZone = {
    x: bounds.x0 + 20,
    y: bounds.y0 + 20,
    w: bounds.x1 - bounds.x0 - 40,
    h: bounds.y1 - bounds.y0 - 40,
  }
  // Сначала по узким высоким комнатам (шахта), потом — по всему плану:
  // на нерегулярных чертежах марш попадает внутрь большой комнаты, и раньше
  // поиск до него не доходил, если хоть один кандидат-шахта нашёлся.
  // Внутри шахты хватает 5 ступеней. По всему плану планка выше: строки
  // подписи идут с равным шагом и на пяти «ступенях» проходят проверку —
  // у настоящего марша их заметно больше.
  const searchZones = candidates.length
    ? [...candidates.map((z) => ({ zone: z, minTreads: 5 })), { zone: wholeZone, minTreads: 8 }]
    : [{ zone: wholeZone, minTreads: 8 }]

  for (const { zone, minTreads } of searchZones) {
    // Ступени — только ВНУТРИ комнаты, не на её верхней/нижней стене
    const yStart = zone.y + 8
    const yEnd = zone.y + zone.h - 8
    const treads = []
    for (let y = yStart; y < yEnd; y++) {
      const row = []
      for (let x = zone.x + 2; x < zone.x + zone.w - 2; x++) row.push(bin[y * w + x])
      for (const [s, e] of clusters(row, 1, 10)) {
        const len = e - s + 1
        // Верхняя граница щедрая: ширина марша зависит от масштаба чертежа
        // (на демо ступени 22px, на коттеджном плане — 44..57). От мусора
        // защищает не длина, а требование ≥5 ступеней с равным шагом.
        if (len >= 12 && len <= 60) treads.push({ y, x: zone.x + 2 + s, len })
      }
    }
    if (treads.length < minTreads) continue

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
      if (g.items.length < minTreads) continue
      const ys = g.items.map((t) => t.y).sort((a, b) => a - b)
      const uniq = [ys[0]]
      for (const y of ys.slice(1)) {
        if (y - uniq[uniq.length - 1] > 3) uniq.push(y)
      }
      if (uniq.length < minTreads) continue
      const gaps = []
      for (let i = 1; i < uniq.length; i++) gaps.push(uniq[i] - uniq[i - 1])
      gaps.sort((a, b) => a - b)
      const step = gaps[Math.floor(gaps.length / 2)]
      // Нижняя граница мелкая: марш из 20+ ступеней даёт шаг в 4–5 px
      if (step < 3 || step > 24) continue
      // Оставить только ступени с шагом ≈ median (отбросить стены)
      const filtered = [uniq[0]]
      for (let i = 1; i < uniq.length; i++) {
        const g = uniq[i] - filtered[filtered.length - 1]
        if (Math.abs(g - step) <= 5 || (g >= step * 0.6 && g <= step * 2.2)) {
          // если большой пропуск — всё равно добавить, но не чаще чем step*2
          if (g <= step * 2.5) filtered.push(uniq[i])
        }
      }
      if (filtered.length < minTreads) continue
      const okGaps = []
      for (let i = 1; i < filtered.length; i++) okGaps.push(filtered[i] - filtered[i - 1])
      const ok = okGaps.filter((g) => Math.abs(g - step) <= 5).length
      if (ok < filtered.length * 0.45) continue
      const avgLen = Math.round(g.items.reduce((s, t) => s + t.len, 0) / g.items.length)
      found.push({
        score: filtered.length * 10 + ok,
        x: Math.round(g.x),
        y: filtered[0],
        len: avgLen,
        step,
        count: filtered.length,
        treads: filtered.map((y) => ({ y, x: Math.round(g.x), len: avgLen })),
      })
    }
  }
  if (!found.length) return []

  // В здании бывает несколько маршей. Одна и та же лестница попадается
  // несколько раз (комната-кандидат + проход по всему плану) — оставляем
  // лучший вариант из перекрывающихся.
  const overlaps = (a, b) => {
    const ah = a.count * a.step
    const bh = b.count * b.step
    return (
      Math.abs(a.x - b.x) < Math.max(a.len, b.len) &&
      Math.min(a.y + ah, b.y + bh) - Math.max(a.y, b.y) > 0
    )
  }
  // Не больше двух маршей на этаж. Штриховки и ряды одинаковых элементов
  // (окна на БТИ-планах) дают десятки «лестниц» с равным шагом — берём
  // только два самых убедительных.
  const kept = []
  for (const cand of [...found].sort((a, b) => b.score - a.score)) {
    if (kept.length >= 2) break
    if (kept.some((k) => overlaps(k, cand))) continue
    kept.push(cand)
  }
  return kept.map(({ x, y, len, step, count, treads }) => ({ x, y, len, step, count, treads }))
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
  return connectedComponents(local, w, h, 12, true).filter((c) => {
    // Не на всю комнату
    if (c.w > room.w * 0.85 && c.h > room.h * 0.85) return false
    if (c.w > room.w - 6 || c.h > room.h - 6) return false
    return c.size <= 900
  })
}

/**
 * Площадь фона, замкнутого внутри компоненты (дырка контура).
 * Санприборы рисуют замкнутым овалом — у них большая дырка;
 * штрихи подписей и обломки стен незамкнуты (дырка ≈ 0).
 */
function enclosedArea(mask, w, h, c) {
  const bw = c.w + 2
  const bh = c.h + 2
  const ink = (bx, by) => {
    const x = c.x - 1 + bx
    const y = c.y - 1 + by
    if (x < 0 || y < 0 || x >= w || y >= h) return 0
    return mask[y * w + x]
  }
  const seen = new Uint8Array(bw * bh)
  const stack = []
  const push = (bx, by) => {
    if (bx < 0 || by < 0 || bx >= bw || by >= bh) return
    const i = by * bw + bx
    if (seen[i] || ink(bx, by)) return
    seen[i] = 1
    stack.push(i)
  }
  for (let bx = 0; bx < bw; bx++) {
    push(bx, 0)
    push(bx, bh - 1)
  }
  for (let by = 0; by < bh; by++) {
    push(0, by)
    push(bw - 1, by)
  }
  while (stack.length) {
    const i = stack.pop()
    const bx = i % bw
    const by = (i / bw) | 0
    push(bx - 1, by)
    push(bx + 1, by)
    push(bx, by - 1)
    push(bx, by + 1)
  }
  let hole = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      if (!ink(bx, by) && !seen[by * bw + bx]) hole++
    }
  }
  return hole
}

/**
 * Классификация блоба: toilet / sink / table / chair / counter.
 * Унитаз: компактный овал (замкнутый контур или заливка) у стены.
 * Стол: крупнее, прямоугольный.
 * @param {number} hole — площадь замкнутого фона внутри блоба (0 = контур незамкнут)
 * @param {number} holeWall — то же, но стена считается частью контура:
 *   раковина у стены рисуется полукругом и сама по себе не замкнута
 */
function classifyBlob(c, room, hole = 0, holeWall = 0) {
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
  // Санузел/тамбур: прибор в такой комнате всегда «у стены»
  const isSmallRoom = room.w <= 160 && room.h <= 180
  // Замкнутый контур: дырка занимает заметную часть габарита
  const isRing = hole >= 30 && hole >= c.w * c.h * 0.22
  // Полукруг: замыкается только вместе со стеной — это раковина (§8.5 п.2)
  const isHalfRing = !isRing && holeWall >= 24 && holeWall >= c.w * c.h * 0.18

  // Сантехника — контурный овал ИЛИ плотная фигура у стены
  if (isRing && (nearWall || isSmallRoom) && minSide >= 6 && maxSide <= 34) {
    if ((ratio >= 1.6 || ratio <= 0.62) && maxSide <= 30) {
      return { type: 'sink', x: cx, y: cy, w: Math.max(c.w, 10), h: Math.max(c.h, 8) }
    }
    return { type: 'toilet', x: cx, y: cy, w: Math.max(c.w, 10), h: Math.max(c.h, 10) }
  }
  if (isHalfRing && (nearWall || isSmallRoom) && minSide >= 5 && maxSide <= 34) {
    return { type: 'sink', x: cx, y: cy, w: Math.max(c.w, 10), h: Math.max(c.h, 8) }
  }
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
  // Стойка / прямоугольный стол. Тонкая длинная полоса — это обломок
  // перегородки, а не мебель: ограничиваем и толщину, и вытянутость.
  if (maxSide >= 14 && minSide >= 8 && ratio >= 0.2 && ratio <= 5) {
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
 * Подписи на чертеже (не читаются, но и не должны становиться мебелью).
 * Глифы одной строки стоят на общей базовой линии с малыми промежутками;
 * строки одной подписи («Конференц / зал») собираются в блок.
 * @returns {(c: {x,y,w,h}) => boolean} — попадает ли блоб в текст
 */
function textBlockFilter(blobs, w, h) {
  const glyphH = Math.max(9, Math.round(Math.min(w, h) * 0.045))
  // Замкнутый контур в габарите глифа — это нарисованный прибор, а не буква:
  // две раковины по обе стороны перегородки стоят на одной «строке» и без
  // этой проверки попадали бы в подпись. У букв дырка мелкая относительно тела.
  const isDrawnShape = (c) => {
    const area = c.w * c.h
    if (c.w > 34 || c.h > 34) return false
    const hole = Math.max(c.hole ?? 0, c.holeWall ?? 0)
    return hole >= 30 && hole >= area * 0.22
  }
  const glyphs = blobs.filter((c) => c.h <= glyphH && c.w <= glyphH * 5 && !isDrawnShape(c))
  if (glyphs.length < 2) return () => false

  // Строки: цепочки глифов на общей базовой линии
  const parent = glyphs.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < glyphs.length; i++) {
    for (let j = i + 1; j < glyphs.length; j++) {
      const a = glyphs[i]
      const b = glyphs[j]
      // Глифы одного кегля: разнокалиберная мебель в строку не собирается
      if (Math.min(a.h, b.h) < Math.max(a.h, b.h) * 0.55) continue
      const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ov < Math.min(a.h, b.h) * 0.5) continue
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)
      if (gap > Math.max(a.h, b.h) * 1.2) continue
      parent[find(i)] = find(j)
    }
  }
  const lines = new Map()
  glyphs.forEach((c, i) => {
    const r = find(i)
    const L = lines.get(r) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 }
    L.x0 = Math.min(L.x0, c.x)
    L.y0 = Math.min(L.y0, c.y)
    L.x1 = Math.max(L.x1, c.x + c.w)
    L.y1 = Math.max(L.y1, c.y + c.h)
    L.n++
    lines.set(r, L)
  })

  // Блоки: соседние строки одной подписи («Конференц» + «зал»).
  // Блок начинается со строки из ≥2 глифов; одиночные строки только
  // прилипают к блоку — сами по себе текстом не считаются.
  const all = [...lines.values()]
  const blocks = all.filter((L) => L.n >= 2)
  const loose = all.filter((L) => L.n < 2)
  const near = (a, b) => {
    const xOv = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
    const vGap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1)
    const lineH = Math.max(a.y1 - a.y0, b.y1 - b.y0)
    return xOv > 0 && vGap <= lineH * 1.5
  }
  const absorb = (a, b) => {
    a.x0 = Math.min(a.x0, b.x0)
    a.y0 = Math.min(a.y0, b.y0)
    a.x1 = Math.max(a.x1, b.x1)
    a.y1 = Math.max(a.y1, b.y1)
    a.n += b.n
  }
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < blocks.length && !merged; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (!near(blocks[i], blocks[j])) continue
        absorb(blocks[i], blocks[j])
        blocks.splice(j, 1)
        merged = true
        break
      }
    }
    for (let k = loose.length - 1; k >= 0; k--) {
      const b = blocks.find((a) => near(a, loose[k]))
      if (!b) continue
      absorb(b, loose[k])
      loose.splice(k, 1)
      merged = true
    }
  }

  return (c) => {
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2
    return blocks.some((L) => cx >= L.x0 - 2 && cx <= L.x1 + 2 && cy >= L.y0 - 2 && cy <= L.y1 + 2)
  }
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
function findCyanFeatures(cyan, cyanFix, wall, w, h, bounds, rooms) {
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

  // --- Сантехника: насыщенный cyan ВНУТРИ комнаты (не на периметре здания).
  // Комната, залитая светло-голубым (коридор/проход) — НЕ санузел.
  const cyanRatioByRoom = new Map()
  for (const r of rooms) {
    let cnt = 0
    const xA = Math.max(0, r.x + 4)
    const yA = Math.max(0, r.y + 4)
    const xB = Math.min(w - 1, r.x + r.w - 4)
    const yB = Math.min(h - 1, r.y + r.h - 4)
    const area = Math.max(1, (xB - xA + 1) * (yB - yA + 1))
    for (let y = yA; y <= yB; y++) {
      for (let x = xA; x <= xB; x++) {
        if (cyan[y * w + x]) cnt++
      }
    }
    cyanRatioByRoom.set(r, cnt / area)
  }

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
    // комнаты коридора/прохода залиты cyan — не санузел
    if ((cyanRatioByRoom.get(host) ?? 0) > 0.25) continue
    // санузел: не слишком мелкий, НО и не длинная полоса коридора
    if (host.w < 34 || host.h < 30) continue
    if (host.h < 55 && host.w > 120) continue
    // «шахта»/полоса (низкая и широкая или низкая и очень узкая) — не санузел
    if (host.h < 55) continue
    // не коридор-лента
    if (host.w >= 200 && host.h <= 100) continue
    if (!(host.w <= 190 && host.h <= 200)) continue
    const dl = cx - host.x
    const dr = host.x + host.w - cx
    const dt = cy - host.y
    const db = host.y + host.h - cy
    const nearRoomWall = Math.min(dl, dr, dt, db) <= 22
    if (!nearRoomWall) continue
    // прибор должен касаться настоящей стены (wall), а не «висеть» в открытом коридоре
    let touchesWall = false
    const xA = Math.max(0, c.x - 3)
    const xB = Math.min(w - 1, c.x + c.w + 3)
    const yA = Math.max(0, c.y - 3)
    const yB = Math.min(h - 1, c.y + c.h + 3)
    for (let y = yA; y <= yB && !touchesWall; y++) {
      for (let x = xA; x <= xB; x++) {
        if (wall[y * w + x]) {
          touchesWall = true
          break
        }
      }
    }
    if (!touchesWall) continue

    const m = Math.min(dl, dr, dt, db)
    let tankDir
    if (m === dl) tankDir = 'left'
    else if (m === dr) tankDir = 'right'
    else if (m === dt) tankDir = 'up'
    else tankDir = 'down'

    const ratio = c.w / Math.max(1, c.h)
    const isSink = (ratio >= 1.5 || ratio <= 0.65) && Math.max(c.w, c.h) <= 40
    sanitary.push({
      type: isSink ? 'sink' : 'toilet',
      x: cx,
      y: cy,
      w: Math.max(c.w, 10),
      h: Math.max(c.h, 10),
      tankDir,
      // у раковины плоская сторона к стене → выпуклость в комнату
      dir: { left: 'right', right: 'left', up: 'down', down: 'up' }[tankDir],
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
 * Кандидат в коридор: широкая ЛЕНТА, тонкая относительно всего корпуса.
 * Порог по доле высоты защищает от «коридора» из слипшегося ряда кабинетов.
 * @param {number} planH — высота всей застроенной части
 */
function isCorridorBandShape(r, planH) {
  return r.w >= 180 && r.h <= 110 && r.h <= planH * 0.3 && r.w >= r.h * 2.5
}

/** Высота застроенной части (по габаритам всех комнат). */
function roomsExtentH(rooms) {
  if (!rooms.length) return 0
  const top = Math.min(...rooms.map((r) => r.y))
  const bottom = Math.max(...rooms.map((r) => r.y + r.h))
  return bottom - top
}

/**
 * Тот же коридор, что и `band`? Лестничная шахта режет ленту коридора надвое,
 * и второй кусок должен получить тот же тип, а не стать «офисом».
 * Кусок должен быть такой же лентой: та же полоса по Y, близкая высота, вытянутый.
 */
function sameCorridorBand(r, band) {
  if (r === band) return true
  if (r.h < band.h * 0.65 || r.h > band.h * 1.4) return false
  if (r.w < r.h * 2.5) return false
  const ov = Math.min(r.y + r.h, band.y + band.h) - Math.max(r.y, band.y)
  return ov >= Math.min(r.h, band.h) * 0.7
}

/**
 * Собрать roomMeta + sanitary/furniture из ink-блобов.
 */
function collectDetails(binOrInk, wallMask, w, h, rooms, stairs) {
  const sanitary = []
  const furniture = []
  // Подписи ищем сразу по всему плану: строки одной подписи могут выходить
  // за рамку «своей» комнаты, а внутри одной комнаты строки не набираются.
  // Чернила вместе со стенами: раковина-полукруг замкнута только стеной
  const inkAndWalls = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) inkAndWalls[i] = binOrInk[i] || wallMask[i] ? 1 : 0

  const blobsByRoom = rooms.map((r) =>
    findBlobsInRoom(binOrInk, wallMask, w, h, r).map((b) => ({
      ...b,
      hole: enclosedArea(binOrInk, w, h, b),
      holeWall: enclosedArea(inkAndWalls, w, h, b),
    })),
  )
  const isText = textBlockFilter(blobsByRoom.flat(), w, h)

  const roomMeta = rooms.map((r, ri) => {
    const blobs = blobsByRoom[ri].filter((b) => !isText(b))
    const items = blobs.map((b) => classifyBlob(b, r, b.hole, b.holeWall)).filter(Boolean)
    const toilets = items.filter((i) => i.type === 'toilet')
    const sinks = items.filter((i) => i.type === 'sink')
    const furn = items.filter((i) => i.type !== 'toilet' && i.type !== 'sink')

    const isSmall = r.w <= 160 && r.h <= 160
    // Санузел — не только кабинка с унитазом: умывальная с раковинами тоже
    const isService = isSmall && (toilets.length >= 1 || sinks.length >= 1)

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
    const isStairs = (stairs ?? []).some(
      (st) =>
        st.x >= r.x - 6 &&
        st.x <= r.x + r.w + 6 &&
        st.y >= r.y - 10 &&
        st.y <= r.y + r.h + 10,
    )

    return { room: r, isService, isCorridor, isStairs }
  })

  // Коридор — одна лента. Лестничная шахта режет её на части:
  // помечаем все куски, лежащие на той же полосе, что и лучший кандидат.
  {
    const planH = roomsExtentH(rooms)
    let best = -1
    let bestScore = 0
    roomMeta.forEach((m, i) => {
      const r = m.room
      if (m.isService || m.isStairs) return
      if (isCorridorBandShape(r, planH)) {
        const score = r.w / Math.max(r.h, 1)
        if (score > bestScore) {
          bestScore = score
          best = i
        }
      }
    })
    if (best >= 0) {
      const band = roomMeta[best].room
      roomMeta.forEach((m) => {
        if (!m.isService && !m.isStairs && sameCorridorBand(m.room, band)) m.isCorridor = true
      })
    }
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
  const isStairDoor = (d) =>
    (stairs ?? []).some((st) => {
      const sx0 = st.x - 6
      const sx1 = st.x + st.len + 6
      const sy0 = st.y - 6
      const sy1 = st.y + st.count * st.step + 6
      return d.x >= sx0 && d.x <= sx1 && d.y >= sy0 && d.y <= sy1
    })

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
    rooms: rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, poly: r.poly })),
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

  rooms = dropSliverRooms(rooms)

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
  const cyanFeat = findCyanFeatures(cyan, cyanFix || cyan, wall, w, h, bounds, rooms)
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

  let hWalls = findMajorHWalls(bin, w, h)
  // Порог покрытия считается от ширины КАДРА. Если чертёж занимает не весь
  // кадр (заголовок, размерные цепочки, штамп сбоку), несущие стены до него
  // не дотягивают и не находится ни одной. Пробуем ещё раз мягче — от ложных
  // стен по-прежнему защищает проверка плотности, а не покрытие.
  if (!hWalls.length) hWalls = findMajorHWalls(bin, w, h, 0.26)
  let vWalls = findMajorVWalls(
    bin,
    w,
    h,
    hWalls.map((b) => b.y),
  )
  if (!vWalls.length) vWalls = findMajorVWalls(bin, w, h, hWalls.map((b) => b.y), 0.07)
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

  let wallMask = buildWallMask(bin, w, h, hWalls, vWalls)
  let rooms = findRooms(wallMask, w, h, bounds)

  // Доразбор перегородками. Мажорные стены — только те, что тянутся почти на
  // весь план; в реальных чертежах внутренние стены короткие и делят уже
  // выделенную комнату. Поэтому идём итеративно: нашли перегородку → комната
  // распалась на две → в каждой ищем следующую. Без этого нерегулярная
  // планировка остаётся одной комнатой на всё здание.
  for (let pass = 0; pass < 6; pass++) {
    const parts = findPartitionWalls(bin, w, h, rooms, doorGapPx(w, h))
    if (!parts.h.length && !parts.v.length) break
    hWalls = [...hWalls, ...parts.h].sort((a, b) => a.y - b.y)
    vWalls = [...vWalls, ...parts.v].sort((a, b) => a.x - b.x)
    wallMask = buildWallMask(bin, w, h, hWalls, vWalls)
    const next = findRooms(wallMask, w, h, bounds)
    if (next.length <= rooms.length) break
    rooms = next
  }

  // Запасной разбор для чистых линейных чертежей. «Мажорные» стены — это линии
  // почти во всю ширину плана; на коттеджных и БТИ-чертежах внутренние стены
  // короткие, тонкие и нарисованы двойной линией — таких среди них нет, и весь
  // корпус остаётся одной комнатой. Тогда сегментируем по всем чернилам:
  // расширение на 2px замыкает волосяные линии и грани стен.
  // Признак провала — комната во весь корпус: значит внутренние стены в маску
  // не попали. Число комнат тут не показатель: их может быть несколько, но
  // одна накрывает всё здание.
  let inkFallback = false
  {
    const boundsArea = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0)
    const fills = (list) => list.reduce((m, r) => Math.max(m, r.w * r.h), 0) > boundsArea * 0.55
    if (boundsArea > 0 && fills(rooms)) {
      // 1px замыкает волосяные линии, 2px — ещё и двойные грани стены, но
      // склеивает мелкие смежные комнаты. Берём вариант с бо́льшим числом
      // комнат, в котором ни одна уже не накрывает весь корпус.
      for (const r of [1, 2]) {
        const alt = findRooms(inkMask(bin, w, h, r), w, h, bounds).filter(
          (x) => x.w >= 20 && x.h >= 20,
        )
        if (!alt.length || fills(alt)) continue
        if (alt.length > rooms.length) {
          rooms = alt
          inkFallback = true
        }
      }
    }
  }

  const hLines = hWalls.map((b) => b.y)
  const vLines = vWalls.map((b) => b.x)
  rooms = dedupeRooms(snapRooms(rooms, hLines, vLines))
  rooms = clipRoomsToWallSpans(rooms, hWalls, vWalls)
  // Обрезка по внешнему контуру может оставить полоску-огрызок
  // (например, пустой угол за коротким крылом) — это не комната.
  rooms = dropSliverRooms(rooms.filter((r) => r.w >= 20 && r.h >= 20))

  if (!rooms.length) {
    throw new Error('План не найден: не удалось выделить комнаты между стенами.')
  }

  const { windows, doors: edgeDoors } = findOpeningsOnRoomEdges(bin, w, h, rooms, { x0, y0, x1, y1 })
  // При запасном разборе мажорных стен почти нет, и проёмы на рёбрах комнат
  // не находятся. Зато комнаты примыкают друг к другу — ищем двери как
  // разрывы чернил на общих гранях (тот же приём, что в цветном режиме).
  const doors = inkFallback
    ? dedupeOpenings([...edgeDoors, ...findDoorsOnSharedEdges(bin, bin, w, h, rooms)])
    : edgeDoors
  // Обстановку и лестницу ищем по «мягким» чернилам: и контуры санприборов,
  // и ступени рисуют светло-серым — жёсткая бинаризация ловит через одну.
  const softInk = toSoftInk(data, w, h)
  const stairs = findStairs(softInk, w, h, bounds, rooms)
  const { sanitary, furniture, roomMeta } = collectDetails(softInk, wallMask, w, h, rooms, stairs)

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

/** Площадь замкнутой ломаной (формула шнурков), знак отброшен. */
function polygonArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/**
 * Контур здания = объединение прямоугольников комнат.
 * Нужен для Г-образных корпусов: без него внешняя стена рисуется по bbox
 * и обводит пустой угол, которого в здании нет (FloorPlanSvg §3b, floor.outline).
 * @returns {[number, number][] | null} — прямоугольный полигон по часовой стрелке
 */
function roomsUnionOutline(rects) {
  if (rects.length < 2) return null
  // Сетка огрубляется: комнаты одного ряда бывают на пару пикселей разной
  // высоты, и без этого контур покрывается зубцами в 10–15 единиц.
  const grid = (vals, tol) => {
    const sorted = [...new Set(vals)].sort((a, b) => a - b)
    const out = []
    let group = [sorted[0]]
    for (const v of sorted.slice(1)) {
      if (v - group[0] <= tol) group.push(v)
      else {
        out.push(Math.round(group.reduce((s, g) => s + g, 0) / group.length))
        group = [v]
      }
    }
    out.push(Math.round(group.reduce((s, g) => s + g, 0) / group.length))
    return out
  }
  const spanX = Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x))
  const spanY = Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y))
  const tol = Math.max(6, Math.round(Math.min(spanX, spanY) * 0.06))
  const xs = grid(rects.flatMap((r) => [r.x, r.x + r.w]), tol)
  const ys = grid(rects.flatMap((r) => [r.y, r.y + r.h]), tol)
  const nx = xs.length - 1
  const ny = ys.length - 1
  if (nx < 1 || ny < 1) return null

  const inside = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2
    for (let i = 0; i < nx; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2
      const hit = rects.some(
        (r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h,
      )
      if (hit) inside[j * nx + i] = 1
    }
  }
  // Мелкие зазубрины — артефакт разной высоты комнат в ряду, а не форма
  // корпуса: засыпаем выемки мельче 12% габарита.
  const notchY = spanY * 0.12
  const notchX = spanX * 0.12
  const before = inside.slice()
  const was = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : before[j * nx + i])
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (before[j * nx + i]) continue
      const shallow = ys[j + 1] - ys[j] < notchY && (was(i, j - 1) || was(i, j + 1))
      const narrow = xs[i + 1] - xs[i] < notchX && (was(i - 1, j) || was(i + 1, j))
      if (shallow || narrow) inside[j * nx + i] = 1
    }
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : inside[j * nx + i])

  // Направленные рёбра границы: обход по часовой стрелке (ось Y вниз)
  const edges = new Map()
  const add = (ax, ay, bx, by) => edges.set(`${ax},${ay}`, [ax, ay, bx, by])
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue
      if (!at(i, j - 1)) add(xs[i], ys[j], xs[i + 1], ys[j])
      if (!at(i + 1, j)) add(xs[i + 1], ys[j], xs[i + 1], ys[j + 1])
      if (!at(i, j + 1)) add(xs[i + 1], ys[j + 1], xs[i], ys[j + 1])
      if (!at(i - 1, j)) add(xs[i], ys[j + 1], xs[i], ys[j])
    }
  }
  if (!edges.size) return null

  // Самый левый-верхний угол гарантированно лежит на внешнем контуре
  const startKey = [...edges.keys()].sort((a, b) => {
    const [ax, ay] = a.split(',').map(Number)
    const [bx, by] = b.split(',').map(Number)
    return ay - by || ax - bx
  })[0]
  const pts = []
  let key = startKey
  for (let guard = 0; guard < edges.size + 2; guard++) {
    const e = edges.get(key)
    if (!e) return null
    pts.push([e[0], e[1]])
    key = `${e[2]},${e[3]}`
    if (key === startKey) break
  }
  if (pts.length < 4) return null

  // Убрать промежуточные точки на прямых участках
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i + pts.length - 1) % pts.length]
    const c = pts[i]
    const n = pts[(i + 1) % pts.length]
    const collinear = (p[0] === c[0] && c[0] === n[0]) || (p[1] === c[1] && c[1] === n[1])
    if (!collinear) out.push(c)
  }
  if (out.length < 4) return null
  // Если комнаты распались на несколько «островов», обход опишет только один.
  // Такой контур хуже bbox — лучше вернуть null и оставить прямоугольник.
  const bx0 = Math.min(...out.map((p) => p[0]))
  const by0 = Math.min(...out.map((p) => p[1]))
  const bx1 = Math.max(...out.map((p) => p[0]))
  const by1 = Math.max(...out.map((p) => p[1]))
  const covers = rects.every(
    (r) => r.x >= bx0 - tol && r.y >= by0 - tol && r.x + r.w <= bx1 + tol && r.y + r.h <= by1 + tol,
  )
  return covers ? out : null
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
      // Индекс исходной комнаты: снап и чистка наложений пересортировывают
      // массив, поэтому rooms[i] уже не соответствует extracted.rooms[i].
      // Без этой привязки двери и приборы попадают в соседнюю комнату.
      srcIndex: i,
      // Контур комнаты в координатах плана + габариты до снапа: по ним потом
      // пересчитывается ломаная, если снап сдвинул прямоугольник.
      srcPoly: r.poly ? r.poly.map(([px, py]) => [tx(px), ty(py)]) : null,
      srcRect: { x: tx(r.x), y: ty(r.y), w: tw(r.w), h: tw(r.h) },
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
  const bySrc = new Map(rooms.map((r) => [r.srcIndex, r]))

  // Коридор — ОДНА лента: самая широкая низкая комната и все куски
  // на той же полосе (лестничная шахта разрезает коридор пополам).
  {
    const planH = roomsExtentH(rooms)
    let best = -1
    let bestScore = 0
    rooms.forEach((r, i) => {
      if (r.type === 'service') return
      if (isCorridorBandShape(r, planH)) {
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
    if (best >= 0) {
      const band = rooms[best]
      for (const r of rooms) {
        if (r.type !== 'service' && sameCorridorBand(r, band)) r.type = 'corridor'
      }
    } else if (extracted.corridor) {
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

  // Пара самых крупных помещений — почти всегда залы/переговорные, а не кабинеты.
  // Без этого весь конвертированный план выходит одного цвета. Подписи не
  // читаются, поэтому берём только явно выделяющиеся по площади (≥1.35 медианы).
  {
    const offices = rooms.filter((r) => r.type === 'office')
    if (offices.length >= 5) {
      const areas = offices.map((r) => r.w * r.h).sort((a, b) => a - b)
      const median = areas[Math.floor(areas.length / 2)]
      offices
        .filter((r) => r.w * r.h >= median * 1.35)
        .sort((a, b) => b.w * b.h - a.w * a.h)
        .slice(0, 2)
        .forEach((r) => {
          r.type = 'meeting'
        })
    }
  }

  const roomAtImg = (px, py) => {
    const idx = extracted.rooms.findIndex(
      (r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h,
    )
    return idx >= 0 ? (bySrc.get(idx) ?? null) : null
  }

  /** Привязка окна к периметру комнаты (с запасом — cyan часто на стене снаружи заливки). */
  const attachWindow = (op) => {
    const tol = 28
    let best = null
    let bestSide = op.side
    let bestD = Infinity
    for (let i = 0; i < extracted.rooms.length; i++) {
      const r = extracted.rooms[i]
      const room = bySrc.get(i)
      if (!room) continue
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
      best = bySrc.get(bestIdx)
      if (!best) return
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
      const room = bySrc.get(i)
      if (!room) continue
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
    // Раковина — полукруг плоской стороной К стене, значит выпуклость
    // смотрит в комнату: направление обратное бачку унитаза.
    const away = { left: 'right', right: 'left', up: 'down', down: 'up' }
    room.features.push({
      type: s.type,
      x: tx(s.x),
      y: ty(s.y),
      w: Math.max(12, tw(s.w * 1.4)),
      h: Math.max(10, tw(s.h * 1.4)),
      tankDir,
      dir: away[tankDir] ?? 'right',
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

  // Лестницы (в здании их может быть несколько)
  for (const s of extracted.stairs ?? []) {
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
      // Если комната — выделенная шахта (немногим больше самого марша),
      // площадка растягивается на всю комнату: лестница читается серой
      // конструкцией, а не служебным помещением. В большой комнате с маршем
      // в углу так делать нельзя — площадку рисует Room.jsx по габаритам марша.
      const flightH = Math.max(1, (entry.count - 1) * entry.step)
      const isShaft = room.h <= flightH * 1.7 && room.w <= entry.len * 2.4
      if (isShaft) {
        entry.plate = { x: room.x + 3, y: room.y + 3, w: room.w - 6, h: room.h - 6 }
        // Шаг подгоняем так, чтобы весь марш поместился в шахту с полями:
        // снизу иначе ступени лезут в оконный проём, сверху — под дверь,
        // которая почти всегда стоит в торце шахты.
        const padTop = 24
        const padBottom = 20
        const inner = entry.plate.h - padTop - padBottom
        if (entry.count > 1 && inner > 0) {
          entry.step = inner / (entry.count - 1)
          entry.y = entry.plate.y + padTop
        }
      }
      room.features.push(entry)
      if (isShaft) room.type = 'service'
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

  const outline = roomsUnionOutline(rooms) ?? undefined

  // Скошенные стены: если настоящий контур комнаты заметно отличается от её
  // габаритов — отдаём ломаную. Прямоугольные комнаты оставляем прямоугольными:
  // на них работают снап зазоров и стыковка соседей.
  for (const r of rooms) {
    const poly = r.srcPoly
    const base = r.srcRect
    if (poly && base && base.w > 0 && base.h > 0) {
      // Ломаную отдаём, только если форма явно не прямоугольная И описана
      // немногими вершинами: два десятка вершин — это шум обводки, а не скос.
      if (poly.length <= 12 && polygonArea(poly) < base.w * base.h * 0.88) {
        const kx = r.w / base.w
        const ky = r.h / base.h
        r.polygon = poly.map(([px, py]) => [
          Math.round(r.x + (px - base.x) * kx),
          Math.round(r.y + (py - base.y) * ky),
        ])
      }
    }
  }

  // Служебные поля привязки к исходным комнатам — в экспорт не идут
  for (const r of rooms) {
    delete r.srcIndex
    delete r.srcPoly
    delete r.srcRect
  }

  return {
    name: 'Конвертер: план из чертежа',
    floors: [
      {
        level: 1,
        name: '1 этаж — из чертежа',
        bounds: [1000, 640],
        outline,
        rooms,
        objects: [],
      },
    ],
  }
}
