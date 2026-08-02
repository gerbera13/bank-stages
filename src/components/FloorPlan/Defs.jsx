/**
 * SVG <defs>: все фильтры и градиенты плана объявляются ОДИН раз здесь
 * и переиспользуются по id (см. ADR-006, specs/floor-plan-render.md §2).
 *
 * Цвета берутся из CSS-переменных через var() — единственный источник правды для палитры.
 */
export default function Defs() {
  return (
    <defs>
      {/* --- Тени (заметные, для объёма) --- */}
      <filter id="filter-floor-shadow" x="-15%" y="-15%" width="130%" height="140%">
        <feDropShadow dx="0" dy="18" stdDeviation="24" floodColor="#0f172a" floodOpacity="0.35" />
      </filter>

      <filter id="filter-room-shadow" x="-15%" y="-15%" width="130%" height="145%">
        <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#0f172a" floodOpacity="0.38" />
      </filter>

      {/* --- Свечение объектов (hover/selected) --- */}
      <filter id="filter-object-glow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* --- Заливка пола этажа (радиальная: центр светлее) --- */}
      <radialGradient id="grad-floor" cx="50%" cy="42%" r="75%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#eef1f7" />
      </radialGradient>

      {/* --- Заливки комнат по типам (линейные: насыщенный верх → пастельный низ) --- */}
      <linearGradient id="grad-room-hall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#e0e7ff" />
        <stop offset="100%" stopColor="#eef2ff" />
      </linearGradient>
      <linearGradient id="grad-room-office" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#e0f2fe" />
        <stop offset="100%" stopColor="#f0f9ff" />
      </linearGradient>
      <linearGradient id="grad-room-meeting" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fae8ff" />
        <stop offset="100%" stopColor="#fdf4ff" />
      </linearGradient>
      <linearGradient id="grad-room-server" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fde68a" />
        <stop offset="100%" stopColor="#fef3c7" />
      </linearGradient>
      <linearGradient id="grad-room-service" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#d1fae5" />
        <stop offset="100%" stopColor="#ecfdf5" />
      </linearGradient>
      <linearGradient id="grad-room-cafe" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fed7aa" />
        <stop offset="100%" stopColor="#fff7ed" />
      </linearGradient>
      <linearGradient id="grad-room-corridor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#e2e8f0" />
        <stop offset="100%" stopColor="#f1f5f9" />
      </linearGradient>

      {/* --- Паттерн плитки: зелёная заливка + диагональные полоски для объёма --- */}
      <pattern id="pattern-tile-green" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="#f0fdf4" />
        <line x1="0" y1="0" x2="0" y2="8" stroke="#bbf7d0" strokeWidth="1.5" />
      </pattern>

      {/* --- Конус обзора камеры (радиальный: ярче у камеры) --- */}
      <radialGradient id="grad-camera-cone" cx="0%" cy="50%" r="100%">
        <stop offset="0%" stopColor="var(--color-obj-camera)" stopOpacity="0.38" />
        <stop offset="70%" stopColor="var(--color-obj-camera)" stopOpacity="0.08" />
        <stop offset="100%" stopColor="var(--color-obj-camera)" stopOpacity="0" />
      </radialGradient>

      {/* --- Сетка фона (точечная, очень деликатная) --- */}
      <pattern id="pattern-grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <circle cx="0" cy="0" r="1.1" fill="#cbd5e1" opacity="0.45" />
      </pattern>
    </defs>
  )
}
