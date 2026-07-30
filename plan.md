# plan.md — Детальный план разработки

> Пошаговый, production-ready план для ИИ-агента. Каждый этап самодостаточен: содержит цель,
> входные артефакты, конкретные шаги, команды, **файлы для создания/изменения** и
> **определение готовности (DoD)**. Выполнять этапы последовательно; не переходить к
> следующему, пока не выполнен DoD текущего.
>
> **Перед стартом:** прочитать `AGENTS.md`, `context.md`, `technical.md`, `specs/`.

## Легенда статусов

- `[ ]` — не начато
- `[~]` — в работе
- `[x]` — выполнено (отметить при завершении)

---

## Этап 0 — Подготовка рабочего окружения

**Цель:** Инициализировать git-репозиторий и убедиться, что окружение готово.

**Шаги:**
1. Убедиться, что рабочая директория — `/Users/oksana/Documents/github/bank-stages`.
2. `git init` (если ещё не git-репозиторий).
3. Проверить `git config user.name` / `user.email` — задать, если пусто.
4. Создать начальный коммит с документацией (`AGENTS.md`, `README.md`, `technical.md`,
   `context.md`, `plan.md`, `specs/`, `docs/`, `.gitignore`, `.editorconfig`) — **только если
   пользователь разрешил коммит** (см. AGENTS.md §3.2: коммить только с разрешения).

**DoD:**
- [ ] Рабочая директория — git-репозиторий.
- [ ] Документация из этого этапа закоммичена (или staged, если коммит запрещён).

---

## Этап 1 — Каркас проекта (Vite + React + JS)

**Цель:** Получить рабочий Vite + React 19 проект, который запускается `npm run dev`.

**Входные артефакты:** `technical.md` (версии), `specs/project-structure.md`.

**Шаги:**
1. Создать `package.json` вручную (НЕ через `npm create vite`, чтобы контролировать версии и
   структуру). Поля:
   - `"name": "floorplan-studio"`
   - `"private": true`
   - `"type": "module"`
   - `scripts`: `dev`, `build`, `preview`, `lint`, `format` (значения ниже).
2. Установить зависимости (точные версии из `technical.md`):
   ```bash
   npm install react@^19.2 react-dom@^19.2 \
               mobx@^6.16 mobx-react-lite@^4.1 \
               react-zoom-pan-pinch@^4.0 \
               @floating-ui/react@^0.27 \
               lucide-react@^1.27
   npm install -D vite@^8.1 @vitejs/plugin-react@^6.0 \
                  eslint@^10.8 @eslint/js@^10.0 globals@^17.8 \
                  eslint-plugin-react-hooks@^7.1 \
                  eslint-plugin-react-refresh@^0.5 \
                  prettier@^3.9
   ```
3. Создать `vite.config.js`:
   ```js
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'

   export default defineConfig({
     plugins: [react()],
   })
   ```
4. Создать `index.html` (в корне) с `<div id="root">` и подключением `/src/main.jsx`.
5. Создать `src/main.jsx` — минимальный рендер `<App />` в `#root`.
6. Создать `src/App.jsx` — заглушка с текстом «FloorPlan Studio».
7. Создать `src/index.css` — базовый сброс (margin: 0, box-sizing) + `:root` с CSS-переменными
   темы из `specs/design-system.md` (полный набор токенов).
8. Создать `eslint.config.js` (flat config):
   - import recommended от `@eslint/js`, `globals`, `eslint-plugin-react-hooks`,
     `eslint-plugin-react-refresh`.
   - `languageOptions.globals.browser = true`, `parserOptions.ecmaVersion: 'latest'`,
     `sourceType: 'module'`.
   - `ignores: ['dist', 'node_modules']`.
9. Создать `.prettierrc`:
   ```json
   { "semi": false, "singleQuote": true, "jsxSingleQuote": false, "tabWidth": 2,
     "trailingComma": "es5", "printWidth": 90 }
   ```
10. Создать `.prettierignore` (`dist`, `node_modules`, `*.md`).
11. Дополнить `package.json` `scripts`:
    - `"dev": "vite"`
    - `"build": "vite build"`
    - `"preview": "vite preview"`
    - `"lint": "eslint ."`
    - `"format": "prettier --write ."`

**Файлы (создать):**
- `package.json`, `vite.config.js`, `index.html`, `eslint.config.js`, `.prettierrc`,
  `.prettierignore`
- `src/main.jsx`, `src/App.jsx`, `src/index.css`

**Проверка:**
```bash
npm run dev      # открывается страница без ошибок в консоли
npm run lint     # 0 ошибок
npm run build    # собирается в dist/
```

**DoD:**
- [ ] `npm run dev` запускается, страница рендерит заглушку.
- [ ] `npm run lint` — 0 ошибок.
- [ ] `npm run build` — успешно.
- [ ] `src/index.css` содержит все токены дизайн-системы из `specs/design-system.md`.

---

## Этап 2 — Модель данных и мок

**Цель:** Создать мок-данные здания (2–3 этажа) и утилиты геометрии. Это «топливо» для
всех последующих этапов.

**Входные артефакты:** `specs/data-model.md`, `specs/design-system.md` (типы комнат/объектов).

**Шаги:**
1. Создать `src/data/building.js` — экспорт объекта `building` по контракту
   `specs/data-model.md`:
   - `building.name`, `building.floors[]`.
   - Каждый этаж: `id`, `level`, `name`, `rooms[]`, `objects[]`, опц. `bounds`.
   - Комната: `id`, `name`, `type` (из enum типов комнат), `polygon` (массив `[x,y]`), опц.
     `labelAnchor`.
   - Объект: `id`, `type` (`'elevator' | 'camera' | 'atm'`), `x`, `y`, `name`, `status`,
     `details` (объект с типизированными полями по типу).
2. Спроектировать геометрию 1-го этажа **аккуратно и красиво** — это демонстрационный этаж:
   - Размеры ~ в системе координат SVG (например, `viewBox="0 0 1000 640"`).
   - Комнаты: холл, кассовый зал, кафе, офисы, переговорная, серверная, санузлы, коридор.
   - Полигоны должны примыкать друг к другу (без зазоров/наложений) для чистого вида.
   - Расставить 2–3 лифта, 3–4 камеры, 2–3 банкомата в осмысленных позициях.
3. Добавить 2-й и 3-й этажи (можно проще, для демонстрации переключения).
4. Каждый объект получить осмысленные `details` (см. `specs/data-model.md` — поля по типу).
5. Создать `src/utils/geometry.js` — чистые функции:
   - `polygonToPoints(polygon)` → строка для SVG `points`.
   - `polygonCentroid(polygon)` → `{x, y}` (центр масс, для подписи/якоря).
   - `polygonBoundingBox(polygon)` → `{x, y, width, height}`.
   - `toScreenCoords(svgEl, x, y)` → экранные координаты точки SVG (для поповера, через
     `getScreenCTM()` + `DOMPoint`).
6. Покрыть функции `geometry.js` JSDoc-комментариями с формой входных/выходных данных
   (компенсация отсутствия TS — см. ADR-001).

**Файлы (создать):**
- `src/data/building.js`, `src/utils/geometry.js`

**Проверка:**
- Импортировать `building` во временный лог в `App.jsx`, убедиться, что структура
  валидна (3 этажа, на каждом есть rooms и objects). Удалить лог после проверки.

**DoD:**
- [ ] `building.js` соответствует контракту `specs/data-model.md`.
- [ ] 3 этажа, у каждого комнаты и объекты всех трёх типов.
- [ ] Геометрия 1-го этажа примыкающая, без зазоров.
- [ ] `geometry.js` экспортирует все функции, задокументированы JSDoc.

---

## Этап 3 — Слоистый SVG-рендер плана (КИЛЛЕР-ФИЧА)

> ⚠️ **Ключевой этап.** Здесь рождается красота. Вложить максимум внимания в визуальное
> качество. Следовать `specs/design-system.md` и `specs/floor-plan-render.md`. Слои — строго
> по спецификации.

**Цель:** Получить красивый статичный план этажа (без объектов и зума — они дальше).

**Входные артефакты:** `specs/design-system.md`, `specs/floor-plan-render.md`,
`src/data/building.js`, `src/utils/geometry.js`.

**Шаги:**
1. Создать `src/components/FloorPlan/FloorPlan.jsx`:
   - Принимает `floor` (объект этажа).
   - Рендерит `<svg>` с `viewBox` по `floor.bounds` (или фиксированным `0 0 1000 640`).
   - Внутри `<defs>`: **все** фильтры и градиенты (см. ADR-006) — мягкая тень пола, тень
     комнат, свечение объектов, градиенты заливки комнат по типу.
   - Группировка по слоям через `<g id="layer-...">` в порядке из
     `specs/floor-plan-render.md`.
2. Реализовать слой **фон/сетка**: лёгкая точечная/линейная сетка через `<pattern>`, очень
   деликатная (не отвлекает).
3. Реализовать слой **пол здания**: общий контур этажа с мягкой тенью (`filter-soft-shadow`),
   заливка-градиент (едва заметное затемнение к краям для «воздуха»).
4. Реализовать компонент `Room.jsx` — отрисовка комнаты:
   - `<polygon>` с заливкой-градиентом по `room.type` (палитра из дизайн-системы).
   - Толстая обводка стен (цвет/толщина стен из дизайн-системы), скруглённые углы
     (`stroke-linejoin="round"`).
   - Подпись названия — `<text>` по центроиду, с подложкой-плашкой (`<rect>` с
     полупрозрачным фоном), аккуратная типографика.
5. Реализовать «двери» — разрывы в обводке стен (упрощённо: тонкие сегменты без обводки на
   стыках комнат, либо условные дуги). На MVP достаточно условного обозначения.
6. Создать `FloorPlan.module.css` — стили слоёв, transitions (пока минимальные).
7. Интегрировать `FloorPlan` в `App.jsx` с активным этажом из мока (пока без стора).

**Файлы (создать):**
- `src/components/FloorPlan/FloorPlan.jsx`
- `src/components/FloorPlan/Room.jsx`
- `src/components/FloorPlan/FloorPlan.module.css`

**Визуальные чек-точки (смотреть в браузере):**
- Комнаты не плоские — градиенты, глубина через тени.
- Стены читаются как стены (толстые, аккуратные).
- Подписи читаемы, не сливаются с заливкой.
- Нет «рваных» артефактов; примыкания комнат чистые.
- Свет/тени согласованы (единое направление виртуального источника).

**DoD:**
- [ ] План рендерится слоисто, строго по `specs/floor-plan-render.md`.
- [ ] Все фильтры/градиенты — в едином `<defs>`, переиспользуются по `id`.
- [ ] Визуально — премиальный Modern Minimal (сверить со скриншотом-референсом в
      `specs/design-system.md`).
- [ ] `npm run lint` чист.

---

## Этап 4 — Зум и панорамирование

**Цель:** План плавно масштабируется и перемещается. Кнопки +/−/сброс.

**Входные артефакты:** ADR-004 (`technical.md`), `specs/zoom-pan.md`.

**Шаги:**
1. Обернуть `<svg>` плана в `TransformWrapper` / `TransformComponent` из
   `react-zoom-pan-pinch`.
2. Настроить ограничения (`minScale`, `maxScale`, `doubleClick`, pan-ограничения) по
   `specs/zoom-pan.md`.
3. Создать `src/components/Controls/ZoomControls.jsx`:
   - Кнопки `+`, `−`, «сброс» (иконки из `lucide-react`: `Plus`, `Minus`, `Maximize`/`Locate`).
   - Используют императивный API через `useControls` (или `ref` на `TransformWrapper`).
   - Плавные анимированные переходы масштабирования.
4. Разместить `ZoomControls` поверх плана (absolute, нижний-правый угол).
5. Стилизовать кнопки (премиальный вид: скругления, мягкая тень, hover-эффект) в
   `Controls.module.css`.

**Файлы (создать):**
- `src/components/Controls/ZoomControls.jsx`
- `src/components/Controls/Controls.module.css`
- (изменить) `FloorPlan.jsx` — обёртка Transform.

**Визуальные/поведенческие чек-точки:**
- Колесо масштабирует к курсору без дёрганий.
- Перетаскивание панорамирует плавно, с инерцией.
- Кнопки +/−/сброс работают анимированно.
- План нельзя утащить бесконечно (ограничения).

**DoD:**
- [ ] Зум колесом, пан перетаскиванием, кнопки — работают.
- [ ] Ограничения масштаба/панорамирования заданы.
- [ ] Кнопки стилизованы в стиле Modern Minimal.
- [ ] `npm run lint` чист.

---

## Этап 5 — Особые объекты на плане

**Цель:** Объекты (лифты, камеры, банкоматы) красиво отрисованы и интерактивны (hover,
выбор).

**Входные артефакты:** `specs/objects.md`, `specs/design-system.md`.

**Шаги:**
1. Создать `src/components/FloorPlan/PlanObject.jsx`:
   - Принимает `obj`, рендерит `<g>` с позицией `translate(x, y)`.
   - **Камера** — иконка + **конус обзора**: полигон/сектор с радиальным градиентом,
     полупрозрачный, светящийся (направление/угол из `obj.details.angle`, если есть).
   - **Лифт** — иконка-капсула с бликом и тенью.
   - **Банкомат** — иконка в цветном бейдже.
   - Иконки — встроенный SVG (path) или из набора; цвета по типу из дизайн-системы.
   - Состояния: `rest` → `hover` (увеличение scale 1.0→1.1, усиление свечения) → `selected`
     (пульсирующая обводка-кольцо, анимация через CSS `@keyframes`).
2. Создать `src/components/FloorPlan/icons.js` — SVG-разметка иконок типов объектов
   (переиспользуемые функции/компоненты).
3. Интегрировать объекты в `FloorPlan.jsx` верхним слоем (`<g id="layer-objects">`),
   рендер по `floor.objects`.
4. Hover/selection-логика пока локальная (`useState` в компоненте объекта допустимо для
   локального hover; **выбор** объекта в Этапе 6 переедет в `SelectionStore`).
5. Анимации: `transition` на `transform`, `filter`, `opacity` с `cubic-bezier`
   (~200–300ms) в `FloorPlan.module.css` / `PlanObject` стилях.

**Файлы (создать):**
- `src/components/FloorPlan/PlanObject.jsx`
- `src/components/FloorPlan/icons.js`
- (изменить) `FloorPlan.jsx`, стили.

**Визуальные чек-точки:**
- Камера имеет видимый конус обзора — читается как камера.
- Иконки объектов единообразны по размеру/весу, цвет — по типу.
- Hover и selection анимированы плавно, без рывков.
- Выбранный объект явно выделен (пульсация).

**DoD:**
- [ ] Три типа объектов отрисованы, у камеры — конус обзора.
- [ ] Hover и selected-состояния работают и анимированы.
- [ ] Объекты — верхним слоем, кликабельны (onClick залогирован/обработан).
- [ ] `npm run lint` чист.

---

## Этап 6 — Состояние (MobX) и выбор объекта

**Цель:** Ввести MobX-сторы, связать выбор объекта/этаж/фильтры с UI.

**Входные артефакты:** ADR-003 (`technical.md`), `specs/state-stores.md`.

**Шаги:**
1. Создать сторы по `specs/state-stores.md`:
   - `src/state/UiStore.js` — `activeFloorId`, `visibleTypes` (Set), действия
     `setActiveFloor(id)`, `toggleType(type)`, computed `activeFloor` (через root.building).
   - `src/state/SelectionStore.js` — `selectedObjectId`, `select(id)`, `clear()`, computed
     `selectedObject`.
   - `src/state/RootStore.js` — `ui`, `selection`, `building` (импорт из `data/building.js`).
   - `src/state/storeContext.js` — `StoreContext` (createContext) + `useStore()` хук.
2. В `src/main.jsx`: создать `const rootStore = new RootStore()`, обернуть `<App />` в
   `<StoreContext.Provider value={rootStore}>`.
3. Сделать интерактивные компоненты `observer` (mobx-react-lite):
   - `FloorPlan` — читает активный этаж из `ui.activeFloor`.
   - `PlanObject` — `onClick` → `selection.select(obj.id)`; подсветка по
     `selection.selectedObjectId === obj.id`; видимость по `ui.visibleTypes.has(type)`.
4. Убрать локальный `useState` для выбора (если был) — перевести в стор.

**Файлы (создать):**
- `src/state/UiStore.js`, `src/state/SelectionStore.js`, `src/state/RootStore.js`,
  `src/state/storeContext.js`
- (изменить) `main.jsx`, `FloorPlan.jsx`, `PlanObject.jsx`.

**Проверка:**
- Клик по объекту подсвечивает его; клик по другому — переключает.
- MobX-реактивность: изменить `activeFloorId` (через код/кнопку) — план обновляется.

**DoD:**
- [ ] Сторы реализованы по `specs/state-stores.md`, с `makeAutoObservable`.
- [ ] Провайдер и `useStore()` работают.
- [ ] Выбор объекта и видимость по типам управляются через стор.
- [ ] Компоненты-наблюдатели — `observer`.
- [ ] `npm run lint` чист.

---

## Этап 7 — Поповер с данными объекта

**Цель:** При выборе объекта всплывает красивый поповер с его деталями.

**Входные артефакты:** ADR-005 (`technical.md`), `specs/popover.md`, `specs/data-model.md`.

**Шаги:**
1. Создать `src/components/ObjectPopover.jsx` — `observer`:
   - Читает `selection.selectedObject` (computed). Если `null` — не рендерится.
   - Шапка: иконка типа + название + бейдж статуса.
   - Тело: детали объекта (по типу — разные поля, см. `specs/data-model.md`).
   - Кнопка закрытия (lucide `X`) → `selection.clear()`.
2. Позиционирование через `@floating-ui/react`:
   - Якорь — выбранный объект. Получить экранные координаты через `toScreenCoords`
     (`utils/geometry.js`) или `getBoundingClientRect()` якорного элемента.
   - Использовать `useFloating` с `flip`, `shift`, `offset`. Стратегия `fixed`.
3. Стилизовать поповер (`ObjectPopover.module.css`): премиальная карточка — мягкая тень,
   скругления, аккуратная типографика, hover/вход-анимация.
4. Интегрировать поповер в `App.jsx` (или `FloorPlan`), рендерится поверх всего.
5. Закрытие по `Escape` и по клику вне поповера (если легко — иначе опционально).

**Файлы (создать):**
- `src/components/ObjectPopover.jsx`, `src/components/ObjectPopover.module.css`

**Визуальные/поведенческие чек-точки:**
- Поповер появляется у выбранного объекта, не вылезая за края.
- Содержимое читаемо, иконография соответствует типу.
- Закрытие работает (крестик, Escape).
- Анимация появления — плавная.

**DoD:**
- [ ] Поповер появляется при выборе, скрывается при `clear`.
- [ ] Позиционирование через @floating-ui, с flip/shift.
- [ ] Содержимое адаптировано под тип объекта.
- [ ] Закрытие (крестик + Escape) работает.
- [ ] `npm run lint` чист.

---

## Этап 8 — Сайдбар: этажи, фильтры, легенда

**Цель:** UI управления — переключение этажей, фильтры по типам, легенда.

**Входные артефакты:** `specs/sidebar.md`, `specs/design-system.md`.

**Шаги:**
1. Создать `src/components/Controls/FloorSwitcher.jsx` — список/селект этажей; клик →
   `ui.setActiveFloor(id)`. Подсветка активного. Сброс выбора при смене этажа
   (`selection.clear()` — либо в `setActiveFloor`, либо в обработчике).
2. Создать `src/components/Controls/TypeFilter.jsx` — чекбоксы/чекипы по типам объектов;
   `checked = ui.visibleTypes.has(type)`; toggle → `ui.toggleType(type)`.
3. Создать `src/components/Legend.jsx` — расшифровка цветов/иконок типов объектов + типов
   комнат (кратко).
4. Собрать сайдбар в `App.jsx` (layout: сайдбар слева/сверху, план в центре). Стилизовать
   (`App.module.css` или общие стили): премиальный вид, согласованность с дизайн-системой.
5. Адаптивность (базовая): на узких экранах сайдбар сворачивается/переносится (минимально
   корректно).

**Файлы (создать):**
- `src/components/Controls/FloorSwitcher.jsx`
- `src/components/Controls/TypeFilter.jsx`
- `src/components/Legend.jsx`
- `src/components/Controls/Controls.module.css` (дополнить) / `App.module.css`
- (изменить) `App.jsx`.

**Проверка:**
- Переключение этажей меняет план.
- Снятие галочки типа скрывает соответствующие объекты.
- Легенда читаема и соответствует плану.

**DoD:**
- [ ] Сайдбар управляет этажом, фильтрами, показывает легенду.
- [ ] Все элементы стилизованы в Modern Minimal.
- [ ] Смена этажа сбрасывает выбор.
- [ ] `npm run lint` чист.

---

## Этап 9 — Полировка

**Цель:** Довести до продакшн-ощущения: анимации, микровзаимодействия, крайние случаи.

**Шаги:**
1. Прогнать все переходы на плавность (`cubic-bezier` тайминги единообразны).
2. Проверить крайние случаи: очень большой/малый зум, выбор объекта у края (поповер
   переворачивается), пустые этажи.
3. Доступность (базовая): фокус-стили на интерактивных элементах, `aria-label` на кнопках,
   `role`/`aria-*` на поповере (`role="dialog"` или `tooltip`-семантика), Esc для закрытия.
4. Семантическая разметка (`<main>`, `<aside>`, `<header>`).
5. Favicons/`<title>`/мета в `index.html`.
6. Проверить производительность: число DOM-узлов SVG, переиспользование фильтров, нет
   тяжёлых перерисовок при зуме.
7. Финальный `npm run lint`, `npm run build`, `npm run preview` — ручной прогон.

**DoD:**
- [ ] Все переходы плавные, единообразные.
- [ ] Крайние случаи обработаны.
- [ ] Базовая a11y на месте.
- [ ] `npm run build` успешно, превью работает.
- [ ] `npm run lint` чист.

---

## Этап 10 — Проверка и сдача

**Цель:** Финальная верификация всей системы.

**Шаги:**
1. Пройти по всем сценариям MVP (`context.md` §7):
   - Открыть этаж → видеть красивый план. ✅
   - Зум/пан (колесо, drag, кнопки). ✅
   - Кликнуть объект → подсветка + поповер с деталями. ✅
   - Сменить этаж. ✅
   - Отфильтровать типы. ✅
   - Легенда читаема. ✅
2. Сверить с дизайн-референсом Modern Minimal.
3. Убедиться, что документация (`docs/`, `specs/`) актуальна (обновить при расхождениях).
4. Отчитаться пользователю: что сделано, что проверено, что осталось/какие риски.

**DoD:**
- [ ] Все сценарии MVP работают.
- [ ] Визуальное качество — премиальное.
- [ ] Документация актуальна.
- [ ] `npm run lint` и `npm run build` чисты.

---

## Сводный список создаваемых файлов (по этапам)

```
package.json, vite.config.js, index.html, eslint.config.js, .prettierrc, .prettierignore  # Э1
src/main.jsx, src/App.jsx, src/index.css                                                   # Э1
src/data/building.js                                                                       # Э2
src/utils/geometry.js                                                                      # Э2
src/components/FloorPlan/FloorPlan.jsx, Room.jsx, FloorPlan.module.css                     # Э3
src/components/Controls/ZoomControls.jsx, Controls.module.css                              # Э4
src/components/FloorPlan/PlanObject.jsx, icons.js                                          # Э5
src/state/UiStore.js, SelectionStore.js, RootStore.js, storeContext.js                     # Э6
src/components/ObjectPopover.jsx, ObjectPopover.module.css                                 # Э7
src/components/Controls/FloorSwitcher.jsx, TypeFilter.jsx, Legend.jsx, App.module.css      # Э8
```

## Оценка последовательности и зависимостей

```
Э0 → Э1 → Э2 → Э3 → Э4 (можно параллельно с Э5 после Э3) → Э5 → Э6 → Э7 → Э8 → Э9 → Э10
```
- Э4 (зум) и Э5 (объекты) независимы после Э3 — можно делать в любом порядке.
- Э6 (MobX) требует Э5 (чтобы было что выбирать) — но можно вводить стор и раньше.
- Э7 (поповер) требует Э6 (выбор в сторе).

---

## Примечания для ИИ-агента

- **Не пропускать DoD.** Каждый этап должен быть доведён до зелёного.
- **Проверять в браузере** (`npm run dev`) после каждого этапа, особенно визуальных (Э3, Э5,
  Э7, Э8, Э9).
- **Коммитить — только с разрешения пользователя** (AGENTS.md).
- **Если застрял** на визуальном качестве — свериться с `specs/design-system.md` и
  `specs/floor-plan-render.md`; не деградировать ради «просто работает».
- **Документация живая:** если в ходе реализации выяснилось, что контракт/спека неточна —
  обновить её и сообщить пользователю.
