/**
 * Метаданные типов объектов (для фильтра и легенды).
 * Чистый модуль без JSX, чтобы не смешивать с компонентами (react-refresh).
 */

export const OBJECT_TYPES = [
  { value: 'elevator', label: 'Лифты', colorVar: '--color-obj-elevator' },
  { value: 'camera', label: 'Камеры', colorVar: '--color-obj-camera' },
  { value: 'atm', label: 'Банкоматы', colorVar: '--color-obj-atm' },
  { value: 'stairs', label: 'Лестницы', colorVar: '--color-obj-stairs' },
]
