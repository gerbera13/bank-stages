# Спецификация: Сайдбар (этажи, фильтры, легенда)

> Боковая панель управления. Компоненты: `FloorSwitcher`, `TypeFilter`, `Legend`.
> Состояние — через `useStore()` (`ui`, `selection`). Стили — `Controls.module.css`.

## 1. Layout (в `App.jsx`)

```
┌──────────────┬─────────────────────────────────┐
│              │                                 │
│  SIDEBAR     │        ПЛАН (FloorPlan)         │
│  ─────────   │                                 │
│  Этажи       │   (зум/пан + объекты + поповер) │
│  Фильтры     │                                 │
│  Легенда     │                                 │
│              │                       [+]       │  ← ZoomControls (внутри плана)
│              │                       [−]       │
│              │                       [⟳]       │
└──────────────┴─────────────────────────────────┘
```

- Семантика: `<aside class="sidebar">`, `<main class="plan-area">`.
- Sidebar: фиксированной ширины (напр. `280px`) на десктопе; на узких — переносится сверху
  (базовая адаптивность).
- Шапка приложения (`<header>`) сверху или в сайдбаре: название «FloorPlan Studio».

## 2. `FloorSwitcher` (`src/components/Controls/FloorSwitcher.jsx`)

```jsx
const { ui } = useStore()
return (
  <div className={styles.group}>
    <h3>Этаж</h3>
    <div className={styles.floorList}>
      {ui.floors.map((floor) => (
        <button
          key={floor.id}
          className={floor.id === ui.activeFloorId ? styles.active : ''}
          onClick={() => ui.setActiveFloor(floor.id)}
        >
          <span className={styles.level}>{floor.level}</span>
          <span className={styles.floorName}>{floor.name}</span>
        </button>
      ))}
    </div>
  </div>
)
```

- Список кнопок-«карточек»: слева крупно номер этажа, справа название.
- Активный этаж — подсветка (`--color-accent-soft` фон + `--color-accent` текст/граница).
- Клик → `ui.setActiveFloor(id)` (внутри сбросится выбор — см. `state-stores.md`).

## 3. `TypeFilter` (`src/components/Controls/TypeFilter.jsx`)

```jsx
const { ui } = useStore()
const TYPES = [
  { value: 'elevator', label: 'Лифты',   colorVar: '--color-obj-elevator' },
  { value: 'camera',   label: 'Камеры',  colorVar: '--color-obj-camera' },
  { value: 'atm',      label: 'Банкоматы', colorVar: '--color-obj-atm' },
]
return (
  <div className={styles.group}>
    <h3>Объекты</h3>
    {TYPES.map((t) => (
      <label key={t.value} className={styles.filterRow}>
        <input
          type="checkbox"
          checked={ui.isTypeVisible(t.value)}
          onChange={() => ui.toggleType(t.value)}
        />
        <span className={styles.swatch} style={{ background: `var(${t.colorVar})` }} />
        <span>{t.label}</span>
      </label>
    ))}
  </div>
)
```

- Чекбоксы с цветным образцом (swatch) и подписью.
- `checked` — из `ui.visibleTypes`; toggle → `ui.toggleType`.
- Снятие галочки мгновенно скрывает объекты этого типа на плане.

## 4. `Legend` (`src/components/Legend.jsx`)

Расшифровка:

**Объекты:**
- Лифт / Камера (с конусом обзора) / Банкомат — иконка + подпись + цвет.

**Комнаты (кратко):**
- Холл / Офис / Переговорная / Серверная / Кафе / Санузел / Коридор — цветной образец
  (из `--color-room-*`) + подпись.

Статичные данные (не из стора), просто визуальная справка.

## 5. Стилизация (`Controls.module.css`)

- Группы (`<h3>` + контент): разделены `--space-4` отступами, заголовки `--font-label`
  uppercase, цвет `--color-text-subtle`.
- Кнопки этажей/чекбоксы: `--color-surface` фон, `--shadow-sm`, `--radius-md`, hover —
  лёгкое затемнение/подъём (`translateY(-1px)` + усиление тени), transition
  `--duration-fast`.
- Активное состояние — акцентная палитра.
- Образцы цвета (`swatch`) — круги `12px`, `--radius-full`.

## 6. Адаптивность (базовая)

- Десктоп (≥ 960px): sidebar слева фиксированно, план занимает остаток.
- Планшет/моб (< 960px): sidebar сворачивается в верхнюю панель (горизонтальная компактная
  раскладка) либо скроллится. Цель — минимум «не сломано»; полноценный мобильный UX — Roadmap.

## 7. Чек-лист

- [ ] `FloorSwitcher`: список этажей, активный подсвечен, клик меняет этаж (+ сброс выбора).
- [ ] `TypeFilter`: чекбоксы по типам, toggle скрывает/показывает объекты.
- [ ] `Legend`: объекты + комнаты, читаемо.
- [ ] Layout: сайдбар + область плана, семантические теги.
- [ ] Базовая адаптивность.
- [ ] Все элементы в стиле Modern Minimal.
