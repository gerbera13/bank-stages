# Спецификация: Поповер объекта

> Поповер с детальными данными выбранного объекта. Компонент
> `src/components/ObjectPopover.jsx` (`observer`). Позиционирование — `@floating-ui/react`
> (ADR-005). Содержимое зависит от типа объекта (`data-model.md`).

## 1. Когда показывается

- Читает `selection.selectedObject` (computed).
- Если `null` — поповер не рендерится.
- При выборе объекта → появляется; при `selection.clear()` → исчезает.

## 2. Позиционирование (`@floating-ui/react`)

Якорь — выбранный объект на плане. Получение экранных координат якоря:

- Элемент-якорь: `<g>` объекта имеет `data-object-id`. При показе поповера найти DOM-элемент
  выбранного объекта и взять `getBoundingClientRect()` (центр элемента).
- Либо: конвертировать SVG-координаты `(x, y)` объекта в экранные через
  `toScreenCoords(svgEl, x, y)` (`utils/geometry.js`, через `getScreenCTM()`).

```jsx
import { useFloating, autoUpdate, offset, flip, shift, arrow } from '@floating-ui/react'

const { refs, floatingStyles, placement } = useFloating({
  open: !!selected,
  placement: 'top',
  middleware: [offset(12), flip(), shift({ padding: 16 })],
  whileElementsMounted: autoUpdate,
})
```

- `offset(12)` — отступ от якоря.
- `flip()` — переворот при нехватке места сверху/снизу.
- `shift({ padding: 16 })` — сдвиг, чтобы не вылезать за края.
- Стратегия рендера: поповер в `position: fixed` (поверх всего), `floatingStyles`
  применяются к корневому `<div>` поповера.

> Якорь виртуальный (точка), поэтому `refs.setReference` может указывать на
> DOM-элемент объекта. Реализация — в Этапе 7; см. примеры @floating-ui «virtual element».

## 3. Содержимое

### Шапка
- Иконка типа (из `FloorPlan/icons.js` / отдельной карты).
- Название объекта (`obj.name`).
- Бейдж статуса (`obj.status`) — цвет по статусу (`data-model.md` `ObjectStatus`).

### Тело (по типу объекта)
**elevator (лифт):**
- Грузоподъёмность: `details.capacity`
- Последнее ТО: `details.lastService` (отформатировать дату)
- Производитель: `details.manufacturer` (если есть)
- Этажей обслуживает: `details.floorsServed` (если есть)

**camera (камера):**
- Угол обзора: `details.angle°`
- IP-адрес: `details.ip`
- Запись: `details.recording` → «Идёт запись» / «Не активна»
- Модель: `details.model` (если есть)

**atm (банкомат):**
- Уровень наличности: `details.cash` (визуальный прогресс-бар, если процент)
- Валюта: `details.currency`
- Приём наличных: `details.deposit` → да/нет (если есть)
- Банк: `details.bank` (если есть)

### Подвал
- Кнопка закрытия (lucide `X`) → `selection.clear()`.

## 4. Поведение закрытия

- Клик по крестику → `selection.clear()`.
- `Escape` → `selection.clear()` (глобальный `keydown` listener, пока поповер открыт).
- Клик вне поповера (по плану/пустому месту) → опционально `clear()`. Реализовать через
  обработчик на фоне, если не конфликтует с pan.

## 5. Стилизация (`ObjectPopover.module.css`)

- Карточка: `--color-surface`, тень `--shadow-lg`, радиус `--radius-lg`.
- Шапка: иконка в цветном круге (цвет типа), название `--font-title`, бейдж статуса справа.
- Тело: список «метка — значение» в две колонки, `--font-body`, метки `--color-text-muted`.
- Прогресс-бар наличности (ATM): трек `--color-surface-2`, заливка `--color-obj-atm`.
- Появление: opacity `0→1` + translateY `8px→0`, `--duration-slow --ease-spring`.
- Минимальная/максимальная ширина (напр. `min-width: 240px; max-width: 320px`).

## 6. Доступность (a11y)

- `role="dialog"`, `aria-label={obj.name}`.
- Фокус-менеджмент минимальный: кнопка закрытия в tabIndex; `Escape` закрывает.
- Контраст текста соответствует WCAG AA.

## 7. Чек-лист

- [ ] Появляется только при `selectedObject != null`.
- [ ] Якорится к выбранному объекту; не вылезает за экран (flip/shift).
- [ ] Содержимое адаптировано под тип объекта.
- [ ] Закрытие крестиком и `Escape`.
- [ ] Премиальная стилизация (тень, скругления, анимация появления).
- [ ] a11y: `role="dialog"`, `aria-label`.
