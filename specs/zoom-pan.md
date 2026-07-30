# Спецификация: Зум и панорамирование

> Интерактивное масштабирование и перемещение плана. Библиотека `react-zoom-pan-pinch` v4
> (ADR-004). Компоненты: `FloorPlan.jsx` (обёртка), `Controls/ZoomControls.jsx` (кнопки).

## 1. Контейнер (в `FloorPlan.jsx`)

```jsx
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

<TransformWrapper
  minScale={0.6}
  maxScale={4}
  initialScale={1}
  limitToBounds={true}
  centerOnInit={true}
  wheel={{ step: 0.08, wheelDisabled: false }}
  doubleClick={{ mode: 'zoomIn', step: 0.7 }}
  panning={{ velocityDisabled: false }}
>
  <TransformComponent wrapperClass="fp-zoom-wrapper" contentClass="fp-zoom-content">
    <svg viewBox="0 0 1000 640">{/* слои плана */}</svg>
  </TransformComponent>
  <ZoomControls />
</TransformWrapper>
```

> `ZoomControls` рендерится **внутри** `TransformWrapper`, чтобы получить доступ к
> императивному API через `useControls` / `useTransformContext`.

## 2. Параметры (значения по умолчанию)

| Параметр | Значение | Обоснование |
|---|---|---|
| `minScale` | `0.6` | можно немного отдалить (видно весь этаж с воздухом) |
| `maxScale` | `4` | достаточный зум для деталей |
| `initialScale` | `1` | стартовый масштаб |
| `limitToBounds` | `true` | нельзя утащить план бесконечно |
| `centerOnInit` | `true` | центрировать план при загрузке |
| `wheel.step` | `0.08` | плавное колесо (не рваное) |
| `doubleClick.step` | `0.7` | заметный шаг дабл-клика |

> Значения подобраны для плавности; могут калиброваться в Этапе 4/9.

## 3. Кнопки управления (`ZoomControls.jsx`)

```jsx
import { useControls } from 'react-zoom-pan-pinch'   // или ref-подход
import { Plus, Minus, Maximize2 } from 'lucide-react'

function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls()
  return (
    <div className={styles.controls}>
      <button aria-label="Приблизить" onClick={() => zoomIn(0.3)}><Plus/></button>
      <button aria-label="Отдалить"   onClick={() => zoomOut(0.3)}><Minus/></button>
      <button aria-label="Сброс"      onClick={() => resetTransform()}><Maximize2/></button>
    </div>
  )
}
```

- Шаг зума `0.3` — заметный, но плавный.
- `resetTransform()` возвращает к `initialScale` + центрирование.
- Иконки — `lucide-react`: `Plus`, `Minus`, `Maximize2` (или `LocateFixed`).

> Если `useControls` недоступен вне детей `TransformWrapper` — использовать `ref` на
> `TransformWrapper` и вызывать `ref.current.zoomIn()` и т.д. Проверить в Этапе 4.

## 4. Расположение кнопок

- Absolute-позиционирование, нижний-правый угол области плана.
- Вертикальная стопка кнопок, каждая — круглая (или скруглённый квадрат) с мягкой тенью.
- `pointer-events: none` на контейнере-обёртке → `pointer-events: auto` на кнопках (чтобы pan
  работал при клике мимо кнопок, но кнопки оставались кликабельны).

## 5. Взаимодействие с кликами по объектам

- `react-zoom-pan-pinch` отличает «перетаскивание» (pan) от «клика». Клик по объекту должен
  срабатывать только если не было существенного перетаскивания.
- В `PlanObject` `onClick` → `selection.select(...)`. Если pan «съедает» клик — настроить
  порог (`panning.disabled` при малом перемещении) или区分ить через события.

## 6. Производительность

- Трансформация применяется к контейнеру (`TransformComponent.contentClass`), не к геометрии
  SVG → геометрия не пересчитывается, плавность.
- CSS `will-change: transform` на контенте — опционально, при тормозах.

## 7. Чек-лист

- [ ] Колесо масштабирует к курсору, плавно.
- [ ] Drag — панорамирование с инерцией.
- [ ] Ограничения `minScale`/`maxScale`/`limitToBounds` работают.
- [ ] Кнопки +/−/сброс работают анимированно.
- [ ] Клик по объекту срабатывает даже после/вместе с pan.
- [ ] `centerOnInit` центрирует план при загрузке.
