# Спецификация: Структура проекта

> Финальная структура каталогов и файлов. Назначение каждого файла. ИИ-агент создаёт файлы
> по этому дереву в ходе этапов `plan.md`.

## Дерево проекта

```
bank-stages/
├─ index.html                       # HTML-точка входа Vite, <div id="root">
├─ package.json                     # зависимости, scripts
├─ vite.config.js                   # конфиг Vite + @vitejs/plugin-react
├─ eslint.config.js                 # ESLint flat config
├─ .prettierrc                      # конфиг Prettier
├─ .prettierignore
├─ .editorconfig                    # уже создан
├─ .gitignore                       # уже создан
│
├─ AGENTS.md                        # инструкция для ИИ-агента (создан)
├─ README.md                        # описание проекта (создан)
├─ technical.md                     # ADR / тех. решения (создан)
├─ context.md                       # контекст и инварианты (создан)
├─ plan.md                          # детальный план (создан)
│
├─ specs/                           # технические спецификации
│  ├─ design-system.md              #   дизайн-система (создан)
│  ├─ data-model.md                 #   модель данных (создан)
│  ├─ project-structure.md          #   этот файл
│  ├─ floor-plan-render.md          #   спецификация рендера плана
│  ├─ objects.md                    #   спецификация объектов
│  ├─ zoom-pan.md                   #   зум/пан
│  ├─ popover.md                    #   поповер
│  ├─ sidebar.md                    #   сайдбар (этажи/фильтры/легенда)
│  └─ state-stores.md               #   MobX-сторы
│
├─ docs/                            # пользовательская документация
│  ├─ README.md                     #   путеводитель по docs/
│  ├─ getting-started.md            #   установка и запуск
│  ├─ architecture.md               #   обзор архитектуры
│  ├─ usage.md                      #   как пользоваться приложением
│  └─ contributing.md               #   правила разработки
│
└─ src/
   ├─ main.jsx                      # точка входа React + провайдер RootStore
   ├─ App.jsx                       # корневой layout (сайдбар + план + поповер)
   ├─ App.module.css                # стили layout
   ├─ index.css                     # глобальная тема: CSS-переменные (дизайн-система)
   │
   ├─ data/
   │  └─ building.js                # мок-данные здания (этажи, комнаты, объекты)
   │
   ├─ state/                        # MobX-сторы (классы)
   │  ├─ RootStore.js               #   собирает сторы + building
   │  ├─ UiStore.js                 #   activeFloorId, visibleTypes
   │  ├─ SelectionStore.js          #   selectedObjectId
   │  └─ storeContext.js            #   React Context + useStore()
   │
   ├─ components/
   │  ├─ FloorPlan/                 # КИЛЛЕР-ФИЧА: слоистый SVG-рендер
   │  │  ├─ FloorPlan.jsx           #   публичный observer-компонент (читает стор)
   │  │  ├─ FloorPlan.module.css    #   стили комнат/объектов/анимаций
   │  │  ├─ PlanCanvas.jsx          #   контейнер зум/пан (TransformWrapper)
   │  │  ├─ FloorPlanSvg.jsx        #   слоистый SVG (фон→этаж→комнаты→объекты)
   │  │  ├─ Defs.jsx                #   единый <defs>: фильтры/градиенты (ADR-006)
   │  │  ├─ Room.jsx                #   рендер комнаты (полигон + стены + подпись)
   │  │  ├─ PlanObject.jsx          #   рендер объекта (маркер + конус/свечение)
   │  │  ├─ icons.jsx               #   SVG-иконки типов объектов (только компоненты)
   │  │  └─ objectTypes.js          #   карта типов → иконка/цвет (чистый модуль)
   │  │
   │  ├─ Controls/
   │  │  ├─ ZoomControls.jsx        #   кнопки +/−/сброс (useControls)
   │  │  ├─ FloorSwitcher.jsx       #   переключатель этажей (observer)
   │  │  ├─ TypeFilter.jsx          #   фильтры по типам объектов (observer)
   │  │  └─ Controls.module.css     #   общие стили контролов + сайдбар
   │  │
   │  ├─ ObjectPopover.jsx          # поповер (@floating-ui/react, observer)
   │  ├─ ObjectPopover.module.css   #   стили карточки поповера
   │  ├─ objectDetails.js           #   формирование содержимого по типу (чистая ф-я)
   │  ├─ statusMeta.js              #   метаданные статусов (бейджи)
   │  ├─ objectTypesMeta.js         #   метаданные типов (фильтр/легенда)
   │  └─ Legend.jsx                 #   легенда (типы объектов/комнат)
   │
   └─ utils/
      └─ geometry.js                # чистые функции: полигон, центроид, экранные координаты, конус
```

## Принципы организации

- **Один компонент — один файл** (имя файла = имя компонента, PascalCase).
- **CSS рядом с компонентом** (CSS Module, `.module.css`).
- **Сторы изолированы** в `src/state/`, не импортируются напрямую в утилиты (утилиты чистые).
- **Утилиты** (`src/utils/`) — чистые функции без зависимостей от React/MobX (тестируемые).
- **Данные** (`src/data/`) — только мок-данные и тип-перечисления, без логики.

## Именование

- Компоненты/файлы компонентов: **PascalCase** (`FloorPlan.jsx`).
- Хуки/утилиты: **camelCase** (`useStore`, `polygonCentroid`).
- CSS-модули: `<Component>.module.css`.
- CSS-переменные (в `index.css`): `--kebab-case` (`--color-accent`).
- SVG-`id` фильтров/градиентов: `filter-<name>` / `grad-<name>` (см. `design-system.md`).
