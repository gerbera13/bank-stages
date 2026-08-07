/**
 * SVG <defs>: все фильтры и градиенты плана объявляются ОДИН раз здесь
 * и переиспользуются по id (см. ADR-006, specs/floor-plan-render.md §2).
 *
 * Цвета берутся из CSS-переменных через var() — единственный источник правды для палитры.
 */
export default function Defs() {
  return (
    <defs>
      {/* --- Тени (заметные, для объёма) ---
          Два уровня на каждую поверхность: короткая контактная тень даёт
          толщину, длинная мягкая — высоту над подложкой. */}
      <filter id="filter-floor-shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0f172a" floodOpacity="0.28" />
        <feDropShadow dx="0" dy="34" stdDeviation="34" floodColor="#0f172a" floodOpacity="0.42" />
      </filter>

      {/* Комнаты примыкают вплотную, поэтому их тень держим короткой:
          длинная размывалась бы по соседям и план выглядел бы мутным. */}
      <filter id="filter-room-shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="3" stdDeviation="2" floodColor="#0f172a" floodOpacity="0.22" />
        <feDropShadow dx="0" dy="9" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.3" />
      </filter>

      {/* Стены «выдавлены» над полом — главный источник объёма на плане */}
      <filter id="filter-wall-shadow" x="-25%" y="-25%" width="150%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="2" floodColor="#0f172a" floodOpacity="0.5" />
        <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0f172a" floodOpacity="0.42" />
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

      {/* --- Заливки комнат по типам ---
          Стопы берутся из CSS-переменных `--room-<type>-a/-b`, поэтому палитру
          можно переопределить для отдельного плана: у конвертера своя,
          «чертёжная» (см. Converter.module.css). Свет падает сверху — низ светлее. */}
      <linearGradient id="grad-room-hall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--room-hall-a)" />
        <stop offset="100%" stopColor="var(--room-hall-b)" />
      </linearGradient>
      <linearGradient id="grad-room-office" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--room-office-a)" />
        <stop offset="100%" stopColor="var(--room-office-b)" />
      </linearGradient>
      <linearGradient id="grad-room-meeting" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--room-meeting-a)" />
        <stop offset="100%" stopColor="var(--room-meeting-b)" />
      </linearGradient>
      <linearGradient id="grad-room-server" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--room-server-a)" />
        <stop offset="100%" stopColor="var(--room-server-b)" />
      </linearGradient>
      <linearGradient id="grad-room-service" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--room-service-a)" />
        <stop offset="100%" stopColor="var(--room-service-b)" />
      </linearGradient>
      <linearGradient id="grad-room-cafe" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--room-cafe-a)" />
        <stop offset="100%" stopColor="var(--room-cafe-b)" />
      </linearGradient>
      <linearGradient id="grad-room-corridor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--room-corridor-a)" />
        <stop offset="100%" stopColor="var(--room-corridor-b)" />
      </linearGradient>
      <linearGradient id="grad-room-lift" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--room-lift-a)" />
        <stop offset="100%" stopColor="var(--room-lift-b)" />
      </linearGradient>

      {/* Графитовый туман: три ступени по полтона — для смежных техпомещений,
          которые надо различать, не выводя каждое в отдельный тип комнаты. */}
      <linearGradient id="grad-room-graphite-1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#d7dce2" />
        <stop offset="100%" stopColor="#e6eaee" />
      </linearGradient>
      <linearGradient id="grad-room-graphite-2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ccd2da" />
        <stop offset="100%" stopColor="#dde2e8" />
      </linearGradient>
      <linearGradient id="grad-room-graphite-3" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#c1c9d2" />
        <stop offset="100%" stopColor="#d4dae1" />
      </linearGradient>

      {/* Светлый розовый — вторая переговорная, чтобы не сливалась с первой */}
      <linearGradient id="grad-room-meeting-light" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fbe2ef" />
        <stop offset="100%" stopColor="#fdf1f7" />
      </linearGradient>
      {/* Бежевый — кладовая: тёплый склад среди холодной техники */}
      <linearGradient id="grad-room-beige" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ecdfc9" />
        <stop offset="100%" stopColor="#f5ecdd" />
      </linearGradient>

      {/* Столешница стойки: блик у ближнего угла → притенение у дальнего.
          Накладывается поверх её цвета, поэтому работает с любым `feat.color`. */}
      <linearGradient id="grad-counter-top" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="55%" stopColor="#ffffff" stopOpacity="0.1" />
        <stop offset="100%" stopColor="#0f172a" stopOpacity="0.16" />
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
