/**
 * Мок-данные здания. Контракт — см. specs/data-model.md.
 *
 * Система координат каждого этажа: 1000 × 640 (по умолчанию viewBox SVG).
 *
 * ПЛАНИРОВКА РЕАЛИСТИЧНАЯ:
 * - Центральный коридор-«артерия» соединяет все помещения (по нему можно пройти).
 * - Каждая комната примыкает к коридору и имеет дверь (проём в стене).
 * - Внешние стены (периметр) содержат окна.
 * - Лифты и лестницы расположены В коридоре (транспортные узлы).
 * - Санузлы разделены на мужской (М) и женский (Ж), компактные — на каждом этаже.
 * - Камеры в коридоре (надзор transit-зоны) + в зальных помещениях.
 *
 * Доп. поля Room (расширение контракта data-model.md):
 *   doors:  [{ x, y, w, side }]   — дверные проёмы
 *   windows:[{ x, y, w }]         — оконные проёмы на внешней стене
 *
 * ВНИМАНИЕ: при замене мока на бэкенд контракт моделей должен сохраниться.
 */

export const building = {
  name: 'Бизнес-центр «Меридиан»',
  floors: [
    // ================================================================
    // 1 ЭТАЖ — Холл (демонстрационный)
    // ================================================================
    {
      id: 'f1',
      level: 1,
      name: '1 этаж — Холл',
      bounds: [1000, 640],
      rooms: [
        // --- Верхний ряд комнат ---
        {
          id: 'f1-r1',
          name: 'Главный холл',
          type: 'hall',
          polygon: [
            [80, 60], [400, 60], [400, 280], [80, 280],
          ],
          doors: [{ x: 230, y: 280, w: 50, side: 'bottom' }],
          windows: [{ x: 150, y: 60, w: 70 }, { x: 260, y: 60, w: 70 }],
        },
        {
          id: 'f1-r2',
          name: 'Кафе',
          type: 'cafe',
          polygon: [
            [400, 60], [640, 60], [640, 280], [400, 280],
          ],
          doors: [{ x: 510, y: 280, w: 50, side: 'bottom' }],
          windows: [{ x: 450, y: 60, w: 70 }, { x: 550, y: 60, w: 70 }],
        },
        {
          id: 'f1-r3',
          name: 'Кассовый зал',
          type: 'office',
          polygon: [
            [640, 60], [920, 60], [920, 280], [640, 280],
          ],
          doors: [{ x: 770, y: 280, w: 50, side: 'bottom' }],
          windows: [{ x: 700, y: 60, w: 70 }, { x: 820, y: 60, w: 70 }],
        },
        // --- Коридор: горизонтальная артерия по центру ---
        {
          id: 'f1-r4',
          name: 'Коридор',
          type: 'corridor',
          polygon: [
            [80, 280], [920, 280], [920, 360], [80, 360],
          ],
        },
        // --- Нижний ряд комнат ---
        {
          id: 'f1-r5',
          name: 'Переговорная',
          type: 'meeting',
          polygon: [
            [80, 360], [360, 360], [360, 580], [80, 580],
          ],
          doors: [{ x: 210, y: 360, w: 50, side: 'top' }],
          windows: [{ x: 150, y: 580, w: 70 }, { x: 260, y: 580, w: 70 }],
        },
        {
          id: 'f1-r6',
          name: 'Серверная',
          type: 'server',
          polygon: [
            [360, 360], [640, 360], [640, 580], [360, 580],
          ],
          doors: [{ x: 490, y: 360, w: 50, side: 'top' }],
          windows: [{ x: 430, y: 580, w: 70 }, { x: 540, y: 580, w: 70 }],
        },
        // --- Санузлы: компактные, разделённые М и Ж ---
        {
          id: 'f1-r7',
          name: 'Санузел М',
          type: 'service',
          polygon: [
            [640, 360], [780, 360], [780, 580], [640, 580],
          ],
          doors: [{ x: 710, y: 360, w: 44, side: 'top' }],
        },
        {
          id: 'f1-r8',
          name: 'Санузел Ж',
          type: 'service',
          polygon: [
            [780, 360], [920, 360], [920, 580], [780, 580],
          ],
          doors: [{ x: 850, y: 360, w: 44, side: 'top' }],
        },
      ],
      objects: [
        // Лифт — в коридоре (транспортный узел, западная часть)
        {
          id: 'f1-e1',
          type: 'elevator',
          x: 140,
          y: 320,
          name: 'Лифт №1',
          status: 'working',
          details: {
            capacity: '1000 кг',
            lastService: '2026-06-12',
            manufacturer: 'Otis',
            floorsServed: 5,
          },
        },
        // Лестница — в коридоре рядом с лифтом (запасная/пожарная)
        {
          id: 'f1-s1',
          type: 'stairs',
          x: 200,
          y: 320,
          name: 'Лестница №1',
          status: 'working',
          details: {
            kind: 'Пожарная',
            floors: 5,
            direction: 'Западное крыло',
          },
        },
        // Камеры — в коридоре (надзор transit-зоны)
        {
          id: 'f1-c1',
          type: 'camera',
          x: 380,
          y: 305,
          name: 'Камера коридора',
          status: 'online',
          details: {
            angle: 110,
            direction: 90,
            ip: '10.0.0.13',
            recording: true,
            model: 'AX-M200',
          },
        },
        {
          id: 'f1-c2',
          type: 'camera',
          x: 760,
          y: 305,
          name: 'Камера коридора 2',
          status: 'online',
          details: {
            angle: 110,
            direction: 270,
            ip: '10.0.0.15',
            recording: true,
            model: 'AX-M200',
          },
        },
        {
          id: 'f1-c3',
          type: 'camera',
          x: 800,
          y: 160,
          name: 'Камера касс',
          status: 'offline',
          details: {
            angle: 100,
            direction: 270,
            ip: '10.0.0.14',
            recording: false,
            model: 'AX-M200',
          },
        },
        // Банкоматы — в главном холле у входа
        {
          id: 'f1-a1',
          type: 'atm',
          x: 350,
          y: 100,
          name: 'Банкомат A-1',
          status: 'active',
          details: {
            cash: '75%',
            currency: 'RUB',
            deposit: true,
            bank: 'Меридиан Банк',
          },
        },
        {
          id: 'f1-a2',
          type: 'atm',
          x: 350,
          y: 170,
          name: 'Банкомат A-2',
          status: 'error',
          details: {
            cash: '12%',
            currency: 'RUB',
            deposit: false,
            bank: 'Меридиан Банк',
          },
        },
      ],
    },

    // ================================================================
    // 2 ЭТАЖ — Офисы
    // ================================================================
    {
      id: 'f2',
      level: 2,
      name: '2 этаж — Офисы',
      bounds: [1000, 640],
      rooms: [
        {
          id: 'f2-r1',
          name: 'Офис open-space',
          type: 'office',
          polygon: [
            [80, 60], [560, 60], [560, 280], [80, 280],
          ],
          doors: [{ x: 300, y: 280, w: 50, side: 'bottom' }],
          windows: [{ x: 150, y: 60, w: 70 }, { x: 270, y: 60, w: 70 }, { x: 390, y: 60, w: 70 }],
        },
        {
          id: 'f2-r2',
          name: 'Зона отдыха',
          type: 'cafe',
          polygon: [
            [560, 60], [920, 60], [920, 280], [560, 280],
          ],
          doors: [{ x: 720, y: 280, w: 50, side: 'bottom' }],
          windows: [{ x: 630, y: 60, w: 70 }, { x: 750, y: 60, w: 70 }, { x: 850, y: 60, w: 70 }],
        },
        {
          id: 'f2-r3',
          name: 'Коридор',
          type: 'corridor',
          polygon: [
            [80, 280], [920, 280], [920, 360], [80, 360],
          ],
        },
        {
          id: 'f2-r4',
          name: 'Переговорная «Альфа»',
          type: 'meeting',
          polygon: [
            [80, 360], [430, 360], [430, 580], [80, 580],
          ],
          doors: [{ x: 240, y: 360, w: 50, side: 'top' }],
          windows: [{ x: 150, y: 580, w: 70 }, { x: 260, y: 580, w: 70 }],
        },
        {
          id: 'f2-r5',
          name: 'Переговорная «Бета»',
          type: 'meeting',
          polygon: [
            [430, 360], [710, 360], [710, 580], [430, 580],
          ],
          doors: [{ x: 560, y: 360, w: 50, side: 'top' }],
          windows: [{ x: 500, y: 580, w: 70 }, { x: 610, y: 580, w: 70 }],
        },
        // Санузлы М/Ж — компактные
        {
          id: 'f2-r6',
          name: 'Санузел М',
          type: 'service',
          polygon: [
            [710, 360], [820, 360], [820, 580], [710, 580],
          ],
          doors: [{ x: 760, y: 360, w: 44, side: 'top' }],
        },
        {
          id: 'f2-r7',
          name: 'Санузел Ж',
          type: 'service',
          polygon: [
            [820, 360], [920, 360], [920, 580], [820, 580],
          ],
          doors: [{ x: 870, y: 360, w: 44, side: 'top' }],
        },
      ],
      objects: [
        // Лифт в коридоре
        {
          id: 'f2-e1',
          type: 'elevator',
          x: 140,
          y: 320,
          name: 'Лифт №1',
          status: 'working',
          details: {
            capacity: '1000 кг',
            lastService: '2026-06-12',
            manufacturer: 'Otis',
            floorsServed: 5,
          },
        },
        // Лестница в коридоре
        {
          id: 'f2-s1',
          type: 'stairs',
          x: 200,
          y: 320,
          name: 'Лестница №1',
          status: 'working',
          details: {
            kind: 'Пожарная',
            floors: 5,
            direction: 'Западное крыло',
          },
        },
        // Камеры в коридоре
        {
          id: 'f2-c1',
          type: 'camera',
          x: 380,
          y: 305,
          name: 'Камера коридора',
          status: 'online',
          details: {
            angle: 110,
            direction: 90,
            ip: '10.0.1.10',
            recording: true,
            model: 'AX-M200',
          },
        },
        {
          id: 'f2-c2',
          type: 'camera',
          x: 760,
          y: 305,
          name: 'Камера коридора 2',
          status: 'online',
          details: {
            angle: 110,
            direction: 270,
            ip: '10.0.1.12',
            recording: true,
            model: 'AX-M200',
          },
        },
        // Банкомат в зоне отдыха
        {
          id: 'f2-a1',
          type: 'atm',
          x: 600,
          y: 170,
          name: 'Банкомат B-1',
          status: 'active',
          details: {
            cash: '90%',
            currency: 'RUB',
            deposit: false,
            bank: 'Меридиан Банк',
          },
        },
      ],
    },

    // ================================================================
    // 3 ЭТАЖ — Технический
    // ================================================================
    {
      id: 'f3',
      level: 3,
      name: '3 этаж — Технический',
      bounds: [1000, 640],
      rooms: [
        {
          id: 'f3-r1',
          name: 'Серверный зал',
          type: 'server',
          polygon: [
            [80, 60], [640, 60], [640, 280], [80, 280],
          ],
          doors: [{ x: 350, y: 280, w: 50, side: 'bottom' }],
          windows: [{ x: 150, y: 60, w: 70 }, { x: 270, y: 60, w: 70 }, { x: 390, y: 60, w: 70 }, { x: 510, y: 60, w: 70 }],
        },
        {
          id: 'f3-r2',
          name: 'Электрощитовая',
          type: 'server',
          polygon: [
            [640, 60], [920, 60], [920, 280], [640, 280],
          ],
          doors: [{ x: 770, y: 280, w: 50, side: 'bottom' }],
          windows: [{ x: 700, y: 60, w: 70 }, { x: 820, y: 60, w: 70 }],
        },
        {
          id: 'f3-r3',
          name: 'Коридор',
          type: 'corridor',
          polygon: [
            [80, 280], [920, 280], [920, 360], [80, 360],
          ],
        },
        {
          id: 'f3-r4',
          name: 'Кладовая',
          type: 'service',
          polygon: [
            [80, 360], [430, 360], [430, 580], [80, 580],
          ],
          doors: [{ x: 240, y: 360, w: 50, side: 'top' }],
          windows: [{ x: 150, y: 580, w: 70 }, { x: 260, y: 580, w: 70 }],
        },
        {
          id: 'f3-r5',
          name: 'Архив',
          type: 'office',
          polygon: [
            [430, 360], [710, 360], [710, 580], [430, 580],
          ],
          doors: [{ x: 560, y: 360, w: 50, side: 'top' }],
          windows: [{ x: 500, y: 580, w: 70 }, { x: 610, y: 580, w: 70 }],
        },
        // Санузлы М/Ж — компактные
        {
          id: 'f3-r6',
          name: 'Санузел М',
          type: 'service',
          polygon: [
            [710, 360], [820, 360], [820, 580], [710, 580],
          ],
          doors: [{ x: 760, y: 360, w: 44, side: 'top' }],
        },
        {
          id: 'f3-r7',
          name: 'Санузел Ж',
          type: 'service',
          polygon: [
            [820, 360], [920, 360], [920, 580], [820, 580],
          ],
          doors: [{ x: 870, y: 360, w: 44, side: 'top' }],
        },
      ],
      objects: [
        // Лифт в коридоре
        {
          id: 'f3-e1',
          type: 'elevator',
          x: 140,
          y: 320,
          name: 'Лифт №1',
          status: 'working',
          details: {
            capacity: '1000 кг',
            lastService: '2026-06-12',
            manufacturer: 'Otis',
            floorsServed: 5,
          },
        },
        // Лестница в коридоре
        {
          id: 'f3-s1',
          type: 'stairs',
          x: 200,
          y: 320,
          name: 'Лестница №1',
          status: 'working',
          details: {
            kind: 'Пожарная',
            floors: 5,
            direction: 'Западное крыло',
          },
        },
        // Камеры в коридоре
        {
          id: 'f3-c1',
          type: 'camera',
          x: 380,
          y: 305,
          name: 'Камера коридора',
          status: 'online',
          details: {
            angle: 110,
            direction: 90,
            ip: '10.0.2.05',
            recording: true,
            model: 'AX-Pro',
          },
        },
        {
          id: 'f3-c2',
          type: 'camera',
          x: 760,
          y: 305,
          name: 'Камера коридора 2',
          status: 'online',
          details: {
            angle: 110,
            direction: 270,
            ip: '10.0.2.07',
            recording: true,
            model: 'AX-Pro',
          },
        },
      ],
    },
  ],
}
