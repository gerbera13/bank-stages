# Спецификация: Модель данных

> Контракт данных здания, этажей, комнат и объектов. Источник: `src/data/building.js` (мок).
> Компенсация отсутствия TS (ADR-001): формы описаны здесь и в JSDoc. Любой код, работающий
> с моделью, обязан следовать этому контракту.

## 1. Корневой объект: `Building`

```js
/**
 * @typedef {Object} Building
 * @property {string} name                 — название здания
 * @property {Floor[]} floors              — массив этажей (минимум 1)
 */
```

## 2. `Floor` (этаж)

```js
/**
 * @typedef {Object} Floor
 * @property {string} id                   — уникальный идентификатор этажа ("f1")
 * @property {number} level                — номер этажа (1, 2, 3...) для отображения
 * @property {string} name                 — человекочитаемое название ("1 этаж — Холл")
 * @property {[number, number][]} [bounds] — [width, height] системы координат SVG;
 *                                            по умолчанию [1000, 640]
 * @property {Room[]} rooms                — комнаты этажа
 * @property {MapObject[]} objects         — особые объекты на этаже
 */
```

## 3. `Room` (комната)

```js
/**
 * @typedef {Object} Room
 * @property {string} id                          — уникальный идентификатор ("r1")
 * @property {string} name                        — название ("Главный холл")
 * @property {RoomType} type                      — тип комнаты (см. enum ниже)
 * @property {[number, number][]} polygon         — массив точек [x, y] контура (>= 3 точки)
 * @property {[number, number]} [labelAnchor]     — [x, y] якорь подписи; если нет — центроид
 * @property {Door[]} [doors]                     — дверные проёмы в стенах комнаты
 * @property {Window[]} [windows]                 — оконные проёмы на внешней стене
 */
```

### `Door` (дверь)
```js
/**
 * @typedef {Object} Door
 * @property {number} x            — координата X центра проёма
 * @property {number} y            — координата Y центра проёма
 * @property {number} w            — ширина проёма (в единицах SVG)
 * @property {'top'|'bottom'|'left'|'right'} side — сторона комнаты, на которой дверь
 */
```

### `Window` (окно)
```js
/**
 * @typedef {Object} Window
 * @property {number} x            — координата X центра окна
 * @property {number} y            — координата Y центра окна (на внешней стене)
 * @property {number} w            — ширина окна
 */
```

> Двери и окна — опциональные поля. Рендер: дверь = белый проём-разрыв в стене +
> дуга открывания (четверть круга); окно = двойная голубая линия поверх внешней стены.

### Enum `RoomType`
Допустимые значения (должны совпадать с CSS-переменными в `design-system.md`):

| Значение | Описание |
|---|---|
| `'hall'` | холл |
| `'office'` | офис / рабочая зона |
| `'meeting'` | переговорная |
| `'server'` | серверная |
| `'service'` | санузел / служебное |
| `'cafe'` | кафе / зона отдыха |
| `'corridor'` | коридор |

> Полигон должен быть простым (без самопересечений). Точки — по/против часовой стрелки
> консистентно в пределах данных. Соседние комнаты примыкают (общие рёбра) — без зазоров.

## 4. `MapObject` (особый объект)

```js
/**
 * @typedef {Object} MapObject
 * @property {string} id          — уникальный идентификатор ("e1", "c1", "a1")
 * @property {ObjectType} type    — тип объекта (см. enum ниже)
 * @property {number} x           — координата X центра в системе координат этажа
 * @property {number} y           — координата Y центра
 * @property {string} name        — название ("Лифт №1", "Камера вход")
 * @property {string} status      — статус (см. набор по типу ниже)
 * @property {Object} details     — тип-специфичные детали (см. ниже)
 * @property {string} [roomId]    — id помещения, в котором находится (для отсечения
 *                                  конуса камеры по стенам через clipPath)
 */
```

### Enum `ObjectType`
| Значение | Русское | CSS-токен цвета |
|---|---|---|
| `'elevator'` | лифт | `--color-obj-elevator` |
| `'camera'` | камера | `--color-obj-camera` |
| `'atm'` | банкомат | `--color-obj-atm` |
| `'stairs'` | лестница | `--color-obj-stairs` |

### Enum `ObjectStatus` (общий набор; статус — строка)
| Значение | Смысл | Цвет бейджа |
|---|---|---|
| `'working'` / `'online'` / `'active'` | работает/в сети/активен | зелёный (emerald) |
| `'maintenance'` / `'offline'` / `'error'` | обслуживание/офлайн/ошибка | янтарный/красный |

> Каждый тип использует подмножество этих статусов. Значения статуса — один из перечисленных,
> чтобы UI мог统一 красить бейдж.

## 5. Детали `details` по типу объекта

### `elevator` (лифт)
```js
/**
 * @typedef {Object} ElevatorDetails
 * @property {string} capacity       — грузоподъёмность ("1000 кг")
 * @property {string} lastService    — дата последнего ТО (ISO "2026-06-12")
 * @property {string} [manufacturer] — производитель (опц.)
 * @property {number} [floorsServed] — кол-во обслуживаемых этажей (опц.)
 */
```

### `camera` (камера)
```js
/**
 * @typedef {Object} CameraDetails
 * @property {number} angle      — угол обзора в градусах (для конуса обзора, напр. 110)
 * @property {number} direction  — направление взгляда в градусах (0 = вверх, по часовой)
 * @property {string} ip         — IP-адрес ("10.0.0.12")
 * @property {boolean} recording — идёт ли запись
 * @property {string} [model]    — модель (опц.)
 */
```

> `angle` + `direction` используются рендерером для построения сектора-конуса обзора (см.
> `specs/objects.md`).

### `atm` (банкомат)
```js
/**
 * @typedef {Object} AtmDetails
 * @property {string} cash        — уровень наличности ("75%")
 * @property {string} currency    — валюта ("RUB")
 * @property {boolean} [deposit]  — приём наличных (опц.)
 * @property {string} [bank]      — банк-владелец (опц.)
 */
```

### `stairs` (лестница)
```js
/**
 * @typedef {Object} StairsDetails
 * @property {string} kind        — тип лестницы ("Маршевая" / "Пожарная")
 * @property {number} floors      — сколько этажей соединяет
 * @property {string} [direction] — где расположена / выход ("Западное крыло")
 */
```

## 6. Пример записи (1 объект каждого типа)

```js
{
  id: 'e1', type: 'elevator', x: 120, y: 80,
  name: 'Лифт №1', status: 'working',
  details: { capacity: '1000 кг', lastService: '2026-06-12' }
},
{
  id: 'c1', type: 'camera', x: 300, y: 50,
  name: 'Камера вход', status: 'online',
  details: { angle: 110, direction: 180, ip: '10.0.0.12', recording: true }
},
{
  id: 'a1', type: 'atm', x: 220, y: 210,
  name: 'Банкомат A-1', status: 'active',
  details: { cash: '75%', currency: 'RUB' }
}
```

## 7. Правила и инварианты

- **ID уникальны** в пределах своего множества (room id — на этаже; object id — на этаже).
  Для глобальной уникальности рендерер может композировать `${floorId}:${objectId}`.
- **Координаты** — в системе координат этажа (по умолчанию `0..1000` по X, `0..640` по Y),
  совпадающей с `viewBox` SVG.
- **`polygon`** комнаты: ≥ 3 точек; соседние комнаты примыкают без зазоров/перекрытий.
- **`status`** — строго из набора `ObjectStatus`, чтобы бейдж красился единообразно.
- **`details`** — поля по типу; неизвестные поля игнорируются UI (forward-compat при добавлении
  новых).
- При замене мока на бэкенд контракт моделей **должен сохраниться** (ADR-008).
