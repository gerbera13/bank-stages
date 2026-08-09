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
 *
 * Маска нужна ЖЁСТКАЯ (тело стены). По мягкой проёмы не видны: створку двери
 * и стекло рисуют светло-серым, и разрыв выглядит заполненным.
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
  const thick = Math.max(1, Math.round(wall.thickness ?? 2))
  const half = Math.max(2, Math.round(thick / 2) + 1)
  // «Стена здесь есть» = чернила лежат ПО ОБЕ СТОРОНЫ от осевой линии.
  //
  // Порог «сколько чернил поперёк» здесь не работает ни в каком виде: чертежи
  // тянут его в разные стороны. Считать от объявленной толщины — на демо она
  // вышла 11 вместо 6, порог задрался, и пять дверей нижнего ряда кабинетов
  // читались как сплошная стена. Считать от медианы профиля — рушатся коттедж
  // и БТИ, где стены тонкие и проёмов не остаётся вовсе. Признак «хоть один
  // пиксель» тоже не годится: у толстой наружной стены грань продолжается
  // через окно, и окон не видно совсем.
  //
  // Двусторонность свободна от порога и верна для всех трёх типов стен:
  // у сплошной чернила с обеих сторон, у двойной линии — обе грани, у тонкой
  // линия лежит на самой осевой и засчитывается в обе стороны. В проёме же
  // пропадает либо всё, либо всё кроме одной наружной грани.
  // Смотрим НЕМНОГО ЗА края стены. Стена нередко обрывается ровно на проёме:
  // на демо перегородка между кабинками санузла идёт x41..96, а двери лежат
  // в 44..52 и 84..94 — впритык к её концам. Правило «разрыв у края — это
  // незакрытый конец, а не дверь» съедало их обе, и все двери санузла
  // пропадали. По запасу видно, что за проёмом стена продолжается.
  const pad = Math.max(6, Math.round(minGap * 1.5))
  const across = []
  for (let t = -pad; t <= len + pad; t++) {
    const px = wall.x1 + ux * t
    const py = wall.y1 + uy * t
    let up = false
    let down = false
    for (let n = -half; n <= half; n++) {
      const x = Math.round(px + nx * n)
      const y = Math.round(py + ny * n)
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if (!ink[y * w + x]) continue
      if (n <= 0) up = true
      if (n >= 0) down = true
    }
    across.push(up && down)
  }
  // Сплошные и пустые куски профиля подряд.
  const runs = []
  for (let k = 0; k < across.length; k++) {
    const solid = across[k]
    const last = runs[runs.length - 1]
    if (last && last.solid === solid) last.end = k
    else runs.push({ solid, start: k, end: k })
  }
  // Требовать по бокам от разрыва длинных кусков стены нельзя: на коттедже и
  // БТИ стены и так рваные, и при пороге даже в 2 px дверей остаётся 4 из 12.
  // Достаточно того, что стена есть с обеих сторон хоть чем-то.
  const solidEnough = 1
  const out = []
  for (let i = 1; i + 1 < runs.length; i++) {
    const r = runs[i]
    if (r.solid) continue
    const before = runs[i - 1]
    const after = runs[i + 1]
    if (before.end - before.start + 1 < solidEnough) continue
    if (after.end - after.start + 1 < solidEnough) continue
    const width = r.end - r.start + 1
    if (width < minGap || width > maxGap) continue
    const mid = (r.start + r.end) / 2 - pad
    out.push({ x: wall.x1 + ux * mid, y: wall.y1 + uy * mid, width, ux, uy, nx, ny })
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
 * Лестницы: стопка одинаковых штрихов с равным шагом — прямо ПО ЧЕРНИЛАМ.
 *
 * Раньше марш искался по отрезкам, найденным Хафом, и это было ненадёжно:
 * порог голосов (25) выше длины ступени (на демо 26 px, впритык), поэтому
 * ступень собственной прямой почти не становилась. Лестница держалась на
 * случайной диагонали через концы ступеней, и любая правка первых стадий
 * её роняла — так случилось четыре раза подряд.
 *
 * Здесь Хаф не участвует вовсе: ищем в маске ряды подряд идущих чернил,
 * склеиваем соседние ряды в ступень, и группируем ступени одинаковой ширины
 * с равномерным шагом. Угол при этом поддерживается только прямой — марши
 * под наклоном чертежи рисуют редко, а ложных срабатываний так меньше.
 */
function runsOf(ink, w, h, minLen, maxLen, vertical) {
  const W = vertical ? h : w
  const H = vertical ? w : h
  const at = (a, b) => (vertical ? ink[b * w + a] : ink[a * w + b])
  const out = []
  for (let b = 0; b < H; b++) {
    let start = -1
    for (let a = 0; a <= W; a++) {
      const on = a < W && at(b, a)
      if (on && start < 0) start = a
      else if (!on && start >= 0) {
        const len = a - start
        if (len >= minLen && len <= maxLen) out.push({ b, a0: start, a1: a - 1, len })
        start = -1
      }
    }
  }
  return out
}

/** Соседние ряды с почти тем же пробегом — это одна ступень, а не две. */
function collapseRuns(runs) {
  const treads = []
  for (const r of runs) {
    const last = treads[treads.length - 1]
    const overlap = last ? Math.min(last.a1, r.a1) - Math.max(last.a0, r.a0) + 1 : 0
    if (last && r.b - last.b <= 1 && overlap >= Math.min(last.len, r.len) * 0.8) {
      last.b1 = r.b
      last.a0 = Math.min(last.a0, r.a0)
      last.a1 = Math.max(last.a1, r.a1)
      last.len = last.a1 - last.a0 + 1
    } else {
      treads.push({ ...r, b1: r.b })
    }
  }
  return treads
}

function flightsFromTreads(treads, vertical, minTreads) {
  // группируем по совпадающему пробегу: ступени одного марша стоят друг над другом
  const groups = []
  for (const t of treads) {
    const g = groups.find((q) => {
      const ov = Math.min(q.a1, t.a1) - Math.max(q.a0, t.a0) + 1
      return ov >= Math.max(q.len, t.len) * 0.7
    })
    if (g) g.items.push(t)
    else groups.push({ a0: t.a0, a1: t.a1, len: t.len, items: [t] })
  }
  const flights = []
  for (const g of groups) {
    if (g.items.length < minTreads) continue
    g.items.sort((p, q) => p.b - q.b)
    // разрезаем на куски с равномерным шагом
    let run = [g.items[0]]
    const push = (arr) => {
      if (arr.length < minTreads) return
      // Стопка марша компактна: по высоте он сопоставим с длиной ступени, а не
      // растянут через весь лист. Размерные засечки на чертежах БТИ идут такой
      // же равномерной пачкой — 12 штук по 19 px, растянутых на 326, — и без
      // этой проверки план покрывался ложными лестницами.
      const spread = arr[arr.length - 1].b - arr[0].b
      const tread = arr.reduce((acc, t) => acc + t.len, 0) / arr.length
      if (spread > tread * 4) return
      flights.push({
        count: arr.length,
        treads: arr.map((t) => {
          const mid = (t.b + t.b1) / 2
          return vertical
            ? { x1: mid, y1: t.a0, x2: mid, y2: t.a1 }
            : { x1: t.a0, y1: mid, x2: t.a1, y2: mid }
        }),
      })
    }
    // Типичный шаг марша — медиана всех промежутков. Рвём стопку только там,
    // где промежуток резко выбивается: жёсткое «не больше трёх пикселей от
    // предыдущего» разрезало марш демо надвое посреди одной шахты.
    const steps = []
    for (let i = 1; i < g.items.length; i++) steps.push(g.items[i].b - g.items[i - 1].b)
    const sorted = steps.slice().sort((p, q) => p - q)
    const typical = sorted[Math.floor(sorted.length / 2)] || 1
    for (let i = 1; i < g.items.length; i++) {
      const step = steps[i - 1]
      if (step > 1 && step <= typical * 2 && step >= typical * 0.4) run.push(g.items[i])
      else {
        push(run)
        run = [g.items[i]]
      }
    }
    push(run)
  }
  return flights
}

/**
 * Марши на плане. Маска — МЯГКАЯ: ступени часто рисуют светло-серым.
 * @param {Uint8Array} ink маска чернил
 */
export function findStairFlights(ink, w, h) {
  const minSide = Math.min(w, h)
  const minLen = Math.max(8, Math.round(minSide * 0.03))
  const maxLen = Math.round(minSide * 0.35)
  const minTreads = 5
  const out = []
  for (const vertical of [false, true]) {
    const treads = collapseRuns(runsOf(ink, w, h, minLen, maxLen, vertical))
    for (const f of flightsFromTreads(treads, vertical, minTreads)) out.push(f)
  }
  return mergeFlights(out)
}

/**
 * Склеить куски одного марша. Разбиение по шагу иногда рвёт стопку посередине
 * (на демо марш выходил двумя лестницами по 10 ступеней в одной шахте), но
 * куски остаются в том же пробеге и продолжают друг друга.
 */
function mergeFlights(flights) {
  const box = (f) => {
    const xs = f.treads.flatMap((t) => [t.x1, t.x2])
    const ys = f.treads.flatMap((t) => [t.y1, t.y2])
    return {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    }
  }
  const out = []
  for (const f of flights) {
    const b = box(f)
    const near = out.find((g) => {
      const a = box(g)
      const ovX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
      const ovY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
      const wide = Math.max(a.x1 - a.x0, b.x1 - b.x0)
      const tall = Math.max(a.y1 - a.y0, b.y1 - b.y0)
      // один пробег вдоль ступеней и почти вплотную поперёк
      const alongX = ovX >= wide * 0.7 && ovY >= -tall * 0.35
      const alongY = ovY >= tall * 0.7 && ovX >= -wide * 0.35
      return alongX || alongY
    })
    if (near) {
      near.treads = near.treads.concat(f.treads)
      near.count = near.treads.length
    } else out.push({ ...f })
  }
  return out
}
