# Начало работы

## Требования

- **Node.js ≥ 20** (рекомендуется LTS). Проверить: `node --version`.
- **npm ≥ 10**. Проверить: `npm --version`.

> Проект разработан на macOS, но работает на любой ОС с поддержкой Node.js.

## Установка

```bash
# из корня репозитория
npm install
```

Это установит все runtime- и dev-зависимости, перечисленные в `package.json` (React 19,
Vite 8, MobX 6, react-zoom-pan-pinch, @floating-ui/react, lucide-react, ESLint, Prettier).

## Запуск dev-сервера

```bash
npm run dev
```

Vite поднимет dev-сервер и выведет локальный адрес (по умолчанию
`http://localhost:5173`). Откройте его в браузере. Изменения кода применяются мгновенно
(HMR).

## Сборка для продакшена

```bash
npm run build      # сборка в dist/
npm run preview    # локальный превью продакшн-сборки
```

Готовая статика — в `dist/`. Её можно раздать любым статическим хостингом (Nginx, Vercel,
Netlify, GitHub Pages и т.п.).

## Все команды

| Команда | Описание |
|---|---|
| `npm install` | Установить зависимости |
| `npm run dev` | Dev-сервер с HMR |
| `npm run build` | Продакшн-сборка в `dist/` |
| `npm run preview` | Превью продакшн-сборки |
| `npm run lint` | Проверка ESLint |
| `npm run format` | Форматирование кода Prettier |

## Решение проблем

- **Порт занят:** Vite выберет следующий свободный порт сам; см. вывод в консоли.
- **Ошибки линтера:** запустите `npm run format`, затем `npm run lint`. Не коммитьте код с
  ошибками линтера.
- **Пустой экран / ошибка в консоли:** убедитесь, что `npm install` прошёл успешно и версия
  Node ≥ 20.

## Следующие шаги

- Как устроено приложение — [architecture.md](./architecture.md).
- Как пользоваться — [usage.md](./usage.md).
- Как дорабатывать — [contributing.md](./contributing.md).
