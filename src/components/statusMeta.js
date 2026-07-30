/**
 * Метаданные статусов объектов (бейджи поповера).
 * Чистый модуль. Контракт статусов — specs/data-model.md (ObjectStatus).
 */

const OK = {
  color: 'var(--color-status-ok)',
  soft: 'rgba(16,185,129,0.12)',
}
const WARN = {
  color: 'var(--color-status-warn)',
  soft: 'rgba(245,158,11,0.12)',
}
const ERR = {
  color: 'var(--color-status-error)',
  soft: 'rgba(239,68,68,0.12)',
}

/** @type {Record<string, { label: string, color: string, soft: string }>} */
export const STATUS_META = {
  working: { ...OK, label: 'Работает' },
  online: { ...OK, label: 'В сети' },
  active: { ...OK, label: 'Активен' },
  maintenance: { ...WARN, label: 'Обслуживание' },
  offline: { ...WARN, label: 'Не в сети' },
  error: { ...ERR, label: 'Ошибка' },
}
