/**
 * Парсер «сырых чертежей»: превращает упрощённую планировку (комнаты-прямоугольники,
 * объекты без деталей) в полный контракт Building (specs/data-model.md).
 *
 * См. полную спецификацию формата: specs/blueprint-import.md.
 *
 * Сырой формат:
 * {
 *   name?: string, bounds?: [number, number],
 *   floors: [{
 *     level?: number, name?: string,
 *     rooms: [{ name: string, type: RoomType, x: number, y: number, w: number, h: number }],
 *     objects?: [{ type: ObjectType, x: number, y: number, name?: string,
 *                  status?: string, details?: object }]
 *   }]
 * }
 */

/** Допустимые типы комнат (должны совпадать с design-system.md) */
const ROOM_TYPES = ['hall', 'office', 'meeting', 'server', 'service', 'cafe', 'corridor', 'lift']

/** Допустимые типы объектов */
const OBJECT_TYPES = ['elevator', 'camera', 'atm', 'stairs']

/** Дефолтный статус по типу объекта */
const DEFAULT_STATUS = {
  elevator: 'working',
  stairs: 'working',
  camera: 'online',
  atm: 'active',
}

/** Префикс ID объекта по типу */
const OBJECT_ID_PREFIX = {
  elevator: 'e',
  stairs: 's',
  camera: 'c',
  atm: 'a',
}

/** Дефолтные details по типу объекта */
const DEFAULT_DETAILS = {
  elevator: { capacity: '1000 кг', lastService: '—' },
  stairs: { kind: 'Пожарная', floors: 1 },
  camera: { angle: 90, direction: 90, ip: '—', recording: true },
  atm: { cash: '—', currency: 'RUB' },
}

/**
 * Прямоугольник комнаты → массив точек полигона (4 точки, по часовой).
 * @param {{x: number, y: number, w: number, h: number}} r
 * @returns {[number, number][]}
 */
function rectToPolygon({ x, y, w, h }) {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
}

/** Нормализовать число с координатой; NaN/бесконечность → null */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Проверить и нормализовать комнату.
 * @param {object} raw — сырое описание комнаты
 * @param {number} index — индекс в списке (для сообщений об ошибках)
 * @param {string} floorId — id этажа
 * @returns {object} комната в контракте Building
 */
function normalizeRoom(raw, index, floorId) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Комната #${index + 1}: ожидается объект`)
  }
  if (!ROOM_TYPES.includes(raw.type)) {
    throw new Error(`Комната «${raw.name ?? `#${index + 1}`}»: неизвестный тип «${raw.type}». Допустимо: ${ROOM_TYPES.join(', ')}`)
  }
  const x = num(raw.x)
  const y = num(raw.y)
  const w = num(raw.w)
  const h = num(raw.h)
  if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) {
    throw new Error(`Комната «${raw.name ?? `#${index + 1}`}»: некорректные координаты x, y, w, h`)
  }
  // Пустое имя остаётся пустым — подпись на плане не рисуется
  // (правило make-stage.md §8.3: если на схеме нет читаемых подписей — не выдумывать).
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  // Готовая ломаная (скошенные стены из конвертера) важнее прямоугольника
  const explicit =
    Array.isArray(raw.polygon) &&
    raw.polygon.length >= 3 &&
    raw.polygon.every((p) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null)
  const room = {
    id: `${floorId}-r${index + 1}`,
    name,
    type: raw.type,
    polygon: explicit ? raw.polygon.map((p) => [p[0], p[1]]) : rectToPolygon({ x, y, w, h }),
  }
  // Детальная прорисовка (из конвертера): двери, окна, элементы интерьера,
  // якорь подписи, размер шрифта, вырезы стен — переносятся как есть.
  if (Array.isArray(raw.doors)) room.doors = raw.doors
  if (Array.isArray(raw.windows)) room.windows = raw.windows
  if (Array.isArray(raw.features)) room.features = raw.features
  if (Array.isArray(raw.wallGaps)) room.wallGaps = raw.wallGaps
  if (Array.isArray(raw.labelAnchor)) room.labelAnchor = raw.labelAnchor
  if (typeof raw.labelFontSize === 'number') room.labelFontSize = raw.labelFontSize
  // Явный градиент заливки — когда смежные комнаты одного типа надо различить
  if (typeof raw.gradient === 'string') room.gradient = raw.gradient
  return room
}

/**
 * Проверить и нормализовать объект.
 * @param {object} raw — сырое описание объекта
 * @param {number} index — индекс в списке
 * @param {string} floorId — id этажа
 * @param {Object<string, number>} counters — счётчики объектов по типам (для нумерации ID)
 * @returns {object} объект в контракте Building
 */
function normalizeObject(raw, index, floorId, counters) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Объект #${index + 1}: ожидается объект`)
  }
  if (!OBJECT_TYPES.includes(raw.type)) {
    throw new Error(`Объект #${index + 1}: неизвестный тип «${raw.type}». Допустимо: ${OBJECT_TYPES.join(', ')}`)
  }
  const x = num(raw.x)
  const y = num(raw.y)
  if (x == null || y == null) {
    throw new Error(`Объект #${index + 1}: некорректные координаты x, y`)
  }
  const type = raw.type
  const prefix = OBJECT_ID_PREFIX[type]
  counters[type] = (counters[type] ?? 0) + 1
  return {
    id: `${floorId}-${prefix}${counters[type]}`,
    type,
    x,
    y,
    name: typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : type === 'elevator' ? 'Лифт' : type === 'camera' ? 'Видеокамера' : type === 'atm' ? 'Банкомат' : 'Лестница',
    status: typeof raw.status === 'string' ? raw.status : DEFAULT_STATUS[type],
    details: raw.details && typeof raw.details === 'object'
      ? { ...DEFAULT_DETAILS[type], ...raw.details }
      : DEFAULT_DETAILS[type],
  }
}

/**
 * Проверить и нормализовать этаж.
 * @param {object} raw — сырое описание этажа
 * @param {number} index — индекс этажа
 * @returns {object} этаж в контракте Building
 */
function normalizeFloor(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Этаж #${index + 1}: ожидается объект`)
  }
  if (!Array.isArray(raw.rooms) || raw.rooms.length === 0) {
    throw new Error(`Этаж #${index + 1}: список комнат (rooms) пуст или отсутствует`)
  }
  const floorId = `f${index + 1}`
  const level = num(raw.level)
  const counters = {}
  // Контур сложной формы (Г-образный корпус): иначе внешняя стена рисуется по bbox
  const outline =
    Array.isArray(raw.outline) &&
    raw.outline.length >= 3 &&
    raw.outline.every((p) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null)
      ? raw.outline.map((p) => [p[0], p[1]])
      : undefined
  return {
    id: floorId,
    level: level ?? index + 1,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Этаж ${index + 1}`,
    bounds: Array.isArray(raw.bounds) && raw.bounds.length === 2 ? raw.bounds : undefined,
    outline,
    rooms: raw.rooms.map((r, i) => normalizeRoom(r, i, floorId)),
    objects: Array.isArray(raw.objects) ? raw.objects.map((o, i) => normalizeObject(o, i, floorId, counters)) : [],
  }
}

/**
 * Превращает «сырой чертёж» в валидный контракт Building.
 * Бросает Error с понятным сообщением при невалидных данных.
 *
 * @param {object} raw — сырой чертёж (см. спецификацию формата)
 * @returns {object} здание по контракту Building (specs/data-model.md)
 */
export function parseBlueprint(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Чертёж: ожидается объект (JSON) с полем floors')
  }
  if (!Array.isArray(raw.floors) || raw.floors.length === 0) {
    throw new Error('Чертёж: отсутствует список этажей (floors)')
  }
  const floors = raw.floors.map((f, i) => normalizeFloor(f, i))
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Здание без названия',
    floors,
  }
}

/**
 * Валидирует сырой чертёж и возвращает диагностику (для отображения пользователю).
 * @param {object} raw
 * @returns {{ ok: boolean, message: string }}
 */
export function validateBlueprint(raw) {
  try {
    parseBlueprint(raw)
    return { ok: true, message: 'Чертёж валиден' }
  } catch (err) {
    return { ok: false, message: err.message }
  }
}

/**
 * Краткое резюме здания после парсинга (для отображения пользователю).
 * @param {object} building — нормализованное здание
 * @returns {string}
 */
export function blueprintSummary(building) {
  const floorCount = building.floors.length
  const roomCount = building.floors.reduce((acc, f) => acc + f.rooms.length, 0)
  const objectCount = building.floors.reduce((acc, f) => acc + f.objects.length, 0)
  return `${building.name}: этажей ${floorCount}, комнат ${roomCount}, объектов ${objectCount}`
}
