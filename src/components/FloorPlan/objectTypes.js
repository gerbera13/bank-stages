/**
 * Конфигурация типов объектов (без JSX — чистый модуль).
 * Карты типов → цвет / мягкий цвет. Иконки-компоненты импортируются отдельно.
 */

import {
  ElevatorIcon,
  CameraIcon,
  AtmIcon,
  StairsIcon,
} from './icons.jsx'

/** Карта типов → компонент иконки */
export const OBJECT_ICONS = {
  elevator: ElevatorIcon,
  camera: CameraIcon,
  atm: AtmIcon,
  stairs: StairsIcon,
}

/** Цвет по типу объекта (из дизайн-системы) */
export const OBJECT_COLORS = {
  elevator: 'var(--color-obj-elevator)',
  camera: 'var(--color-obj-camera)',
  atm: 'var(--color-obj-atm)',
  stairs: 'var(--color-obj-stairs)',
}

/** Мягкий цвет-подложка по типу (для свечения/фона) */
export const OBJECT_SOFT_COLORS = {
  elevator: 'var(--color-obj-elevator-soft)',
  camera: 'var(--color-obj-camera-soft)',
  atm: 'var(--color-obj-atm-soft)',
  stairs: 'var(--color-obj-stairs-soft)',
}
