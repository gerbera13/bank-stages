/**
 * Формирование содержимого поповера по типу объекта.
 * Возвращает массив строк "метка — значение" (для списка) + спецполя (прогресс).
 * Чистая функция, без React — тестируемая.
 *
 * @param {object} obj — объект (контракт specs/data-model.md)
 * @returns {{ rows: { label: string, value: string }[], cashPercent?: number }}
 */
export function getObjectDetails(obj) {
  const d = obj.details ?? {}
  const rows = []

  if (obj.type === 'elevator') {
    if (d.capacity) rows.push({ label: 'Грузоподъёмность', value: d.capacity })
    if (d.lastService)
      rows.push({ label: 'Последнее ТО', value: formatDate(d.lastService) })
    if (d.manufacturer) rows.push({ label: 'Производитель', value: d.manufacturer })
    if (d.floorsServed != null)
      rows.push({ label: 'Этажей обслуживает', value: String(d.floorsServed) })
  } else if (obj.type === 'camera') {
    if (d.angle != null) rows.push({ label: 'Угол обзора', value: `${d.angle}°` })
    if (d.ip) rows.push({ label: 'IP-адрес', value: d.ip })
    rows.push({
      label: 'Запись',
      value: d.recording ? 'Идёт запись' : 'Не активна',
    })
    if (d.model) rows.push({ label: 'Модель', value: d.model })
  } else if (obj.type === 'atm') {
    if (d.cash != null) rows.push({ label: 'Наличность', value: d.cash })
    if (d.currency) rows.push({ label: 'Валюта', value: d.currency })
    if (d.deposit != null)
      rows.push({ label: 'Приём наличных', value: d.deposit ? 'Да' : 'Нет' })
    if (d.bank) rows.push({ label: 'Банк', value: d.bank })
  } else if (obj.type === 'stairs') {
    if (d.kind) rows.push({ label: 'Тип', value: d.kind })
    if (d.floors != null) rows.push({ label: 'Этажей соединяет', value: String(d.floors) })
    if (d.direction) rows.push({ label: 'Выход', value: d.direction })
  }

  // Прогресс-бар для банкомата, если cash — процент
  let cashPercent
  if (obj.type === 'atm' && typeof d.cash === 'string') {
    const m = d.cash.match(/(\d+)/)
    if (m) cashPercent = Math.min(100, Math.max(0, parseInt(m[1], 10)))
  }

  return { rows, cashPercent }
}

/** Локализованная дата из ISO-строки */
function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}
