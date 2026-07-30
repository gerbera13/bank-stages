/**
 * Чистые функции геометрии для SVG-плана.
 * Не зависят от React/MobX — тестируемые и переиспользуемые.
 * Все углы — в градусах, координаты — в системе координат плана (по умолчанию 1000×640).
 */

/**
 * Превращает массив точек полигона в строку для SVG-атрибута `points`.
 * @param {[number, number][]} polygon — массив точек [x, y]
 * @returns {string} — "x1,y1 x2,y2 ..."
 */
export function polygonToPoints(polygon) {
  return polygon.map(([x, y]) => `${x},${y}`).join(' ')
}

/**
 * Центроид (центр масс) полигона — для размещения подписи/якоря.
 * Для невыпуклых полигонов даёт разумный «центр».
 * @param {[number, number][]} polygon
 * @returns {{x: number, y: number}}
 */
export function polygonCentroid(polygon) {
  if (polygon.length === 0) return { x: 0, y: 0 }
  if (polygon.length < 3) {
    // Для отрезка/точки — среднее
    const sum = polygon.reduce(
      (acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }),
      { x: 0, y: 0 }
    )
    return { x: sum.x / polygon.length, y: sum.y / polygon.length }
  }

  // Формула центроида по площади
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i]
    const [x2, y2] = polygon[(i + 1) % polygon.length]
    const cross = x1 * y2 - x2 * y1
    area += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  area /= 2
  if (Math.abs(area) < 1e-6) {
    // Вырожденный полигон — среднее вершин
    const sum = polygon.reduce(
      (acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }),
      { x: 0, y: 0 }
    )
    return { x: sum.x / polygon.length, y: sum.y / polygon.length }
  }
  cx /= 6 * area
  cy /= 6 * area
  return { x: cx, y: cy }
}

/**
 * Ограничивающая рамка полигона.
 * @param {[number, number][]} polygon
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function polygonBoundingBox(polygon) {
  if (polygon.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of polygon) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Переводит точку из системы координат SVG в экранные пиксели.
 * Используется для позиционирования поповера относительно объекта на плане
 * (с учётом текущего зума/пана).
 *
 * @param {SVGSVGElement} svgEl — корневый <svg> элемент
 * @param {number} x — координата X в системе плана
 * @param {number} y — координата Y в системе плана
 * @returns {{x: number, y: number}} — экранные координаты (px)
 */
export function toScreenCoords(svgEl, x, y) {
  const point = svgEl.createSVGPoint()
  point.x = x
  point.y = y
  const ctm = svgEl.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const screen = point.matrixTransform(ctm)
  return { x: screen.x, y: screen.y }
}

/**
 * Строит точки сектора (конуса обзора камеры) как массив [x, y].
 *
 * @param {number} cx — центр по X (камера)
 * @param {number} cy — центр по Y (камера)
 * @param {number} radius — радиус конуса
 * @param {number} angleDeg — угол обзора в градусах (ширина конуса)
 * @param {number} directionDeg — направление взгляда в градусах (0 = вверх, по часовой)
 * @returns {[number, number][]} — точки сектора: центр, дуга, замыкание в центре
 */
export function cameraConePoints(cx, cy, radius, angleDeg, directionDeg) {
  const half = angleDeg / 2
  // Направление 0° = вверх. В SVG «вверх» — это -Y, поэтому смещение на -90°.
  const baseAngle = directionDeg - 90
  const steps = Math.max(8, Math.ceil(angleDeg / 8))
  const points = [[cx, cy]]
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = ((baseAngle - half + angleDeg * t) * Math.PI) / 180
    points.push([
      cx + radius * Math.cos(a),
      cy + radius * Math.sin(a),
    ])
  }
  points.push([cx, cy])
  return points
}
