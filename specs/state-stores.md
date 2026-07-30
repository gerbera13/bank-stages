# Спецификация: MobX-сторы

> Контракт сторов состояния. Реализованы как классы с `makeAutoObservable` (ADR-003).
> Файлы в `src/state/`. Доступ в компонентах — через `useStore()` (React Context).

## 1. `RootStore` (`src/state/RootStore.js`)

Корневой стор: собирает подсторы и держит статичные данные.

```js
import { makeAutoObservable } from 'mobx'
import { building } from '../data/building.js'
import { UiStore } from './UiStore.js'
import { SelectionStore } from './SelectionStore.js'

export class RootStore {
  constructor() {
    this.building = building          // статичные данные (не observable — константа)
    this.ui = new UiStore(this)
    this.selection = new SelectionStore(this)
  }
}
```

> `building` — константа, observable не нужен. Подсторы получают ссылку `root` для доступа к
> данным (computed `activeFloor` и т.п.).

## 2. `UiStore` (`src/state/UiStore.js`)

UI-состояние: активный этаж и видимость типов.

```js
import { makeAutoObservable } from 'mobx'

// Все типы объектов видимы по умолчанию
const ALL_TYPES = ['elevator', 'camera', 'atm']

export class UiStore {
  activeFloorId = 'f1'                       // observable
  visibleTypes = new Set(ALL_TYPES)          // observable (MobX отслеживает Set)

  constructor(root) {
    this.root = root
    makeAutoObservable(this)
  }

  // === Computed ===
  get activeFloor() {
    return this.root.building.floors.find((f) => f.id === this.activeFloorId)
  }

  get floors() {
    return this.root.building.floors
  }

  // === Actions ===
  setActiveFloor(id) {
    this.activeFloorId = id
    // Смена этажа сбрасывает выбор объекта:
    this.root.selection.clear()
  }

  toggleType(type) {
    if (this.visibleTypes.has(type)) this.visibleTypes.delete(type)
    else this.visibleTypes.add(type)
  }

  isTypeVisible(type) {
    return this.visibleTypes.has(type)
  }
}
```

> Сброс выбора при смене этажа инкапсулирован в `setActiveFloor` — компонентам не нужно
> делать это вручную (единая точка ответственности).

## 3. `SelectionStore` (`src/state/SelectionStore.js`)

Состояние выбора объекта.

```js
import { makeAutoObservable } from 'mobx'

export class SelectionStore {
  selectedObjectId = null                    // observable

  constructor(root) {
    this.root = root
    makeAutoObservable(this)
  }

  // === Computed ===
  /** Выбранный объект на активном этаже или null */
  get selectedObject() {
    const floor = this.root.ui.activeFloor
    if (!floor || !this.selectedObjectId) return null
    return floor.objects.find((o) => o.id === this.selectedObjectId) ?? null
  }

  // === Actions ===
  select(id) {
    this.selectedObjectId = id
  }

  clear() {
    this.selectedObjectId = null
  }

  isSelected(id) {
    return this.selectedObjectId === id
  }
}
```

> `selectedObject` ищется **на активном этаже** — поэтому при смене этажа выбор логично
> сбрасывается (объекта прежнего этажа на новом нет).

## 4. Context и хук (`src/state/storeContext.js`)

```js
import { createContext, useContext } from 'react'

export const StoreContext = createContext(null)

/** Возвращает RootStore. Использовать внутри observer-компонентов. */
export function useStore() {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used within <StoreContext.Provider>')
  return store
}
```

## 5. Инициализация (`src/main.jsx`)

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StoreContext } from './state/storeContext.js'
import { RootStore } from './state/RootStore.js'
import App from './App.jsx'
import './index.css'

const rootStore = new RootStore()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StoreContext.Provider value={rootStore}>
      <App />
    </StoreContext.Provider>
  </StrictMode>,
)
```

> Один экземпляр `RootStore` на всё приложение (синглтон через провайдер).

## 6. Правила использования

- **observer:** любой компонент, читающий observable-поля стора, оборачивается в `observer`
  из `mobx-react-lite`.
- **Точечные подписки:** читать из стора только то, что нужно. Например, в `PlanObject`
  читать `selection.isSelected(obj.id)` и `ui.isTypeVisible(obj.type)`, а не весь стор.
- **Действия в сторе:** мутации — только через методы стора (`select`, `setActiveFloor`,
  `toggleType`). Не мутировать observable напрямую из компонента.
- **`useState` — только локально** (hover, локальные UI-флаги), не для разделяемого состояния.
- **Данные (`building`) — read-only** из стора; мок не мутируется.

## 7. Реактивные зависимости (кто на что подписан)

| Поле | Читатели (компоненты) |
|---|---|
| `ui.activeFloorId` / `ui.activeFloor` | `FloorPlan` (рендер активного этажа), `FloorSwitcher` (подсветка) |
| `ui.visibleTypes` | `TypeFilter` (чекбоксы), `PlanObject` (видимость) |
| `selection.selectedObjectId` / `selectedObject` | `PlanObject` (подсветка), `ObjectPopover` (контент/показ) |

## 8. Чек-лист

- [ ] `RootStore` собирает `ui`, `selection`, `building`.
- [ ] `UiStore`: `activeFloorId`, `visibleTypes` (Set), computed `activeFloor`/`floors`,
      actions `setActiveFloor`/`toggleType`/`isTypeVisible`.
- [ ] `SelectionStore`: `selectedObjectId`, computed `selectedObject`, actions
      `select`/`clear`/`isSelected`.
- [ ] `setActiveFloor` сбрасывает выбор.
- [ ] Провайдер в `main.jsx`, `useStore()` с guard на отсутствие провайдера.
- [ ] Все компоненты-читатели — `observer`.
