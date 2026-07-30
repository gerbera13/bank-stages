/**
 * SVG-иконки для типов объектов (внутри цветного бейджа).
 * Все иконки рисуются в координатах viewBox "0 0 24 24", белым цветом (stroke).
 * Единый визуальный вес для консистентности (см. specs/objects.md §7).
 *
 * Константы типов (цвета и карта) — в objectTypes.js, чтобы не смешивать
 * JSX-компоненты и данные (react-refresh warning).
 */

/** Лифт — кабина со стрелками вверх/вниз */
export function ElevatorIcon() {
  return (
    <>
      <rect x="6" y="4" width="12" height="16" rx="1.5" strokeWidth="1.8" />
      <path d="M10 8.5 8.5 10 10 11.5" strokeWidth="1.6" />
      <path d="M14 12.5 15.5 14 14 15.5" strokeWidth="1.6" />
      <path d="M8.5 10h7M15.5 14h-7" strokeWidth="1.6" />
    </>
  )
}

/** Камера — объектив (круг) с креплением */
export function CameraIcon() {
  return (
    <>
      <path d="M3 9.5a2 2 0 0 1 2-2h3l1.5-2h5L18 7.5h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeWidth="1.6" />
      <circle cx="12" cy="13" r="3.2" strokeWidth="1.6" />
    </>
  )
}

/** Банкомат — устройство с купюрой/картой */
export function AtmIcon() {
  return (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth="1.6" />
      <rect x="7.5" y="6" width="9" height="4" rx="0.8" strokeWidth="1.5" />
      <path d="M7.5 14h9M7.5 17h6" strokeWidth="1.5" />
    </>
  )
}

/** Лестница — ступени со стрелкой направления */
export function StairsIcon() {
  return (
    <>
      <path
        d="M4 19h4v-4h4v-4h4V7h4"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M16 4l4 3-4 3" strokeWidth="1.6" strokeLinejoin="round" />
    </>
  )
}
