import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Чтение подписей на чертеже — локальная модель в LM Studio.
      // Напрямую из страницы к ней не обратиться: сервер LM Studio не отдаёт
      // CORS-заголовки и не отвечает на preflight-запрос OPTIONS. Проводим
      // запрос через дев-сервер, тогда для браузера он свой по происхождению.
      // Если LM Studio не запущен, запрос просто не проходит — чтение подписей
      // необязательное, конвертер работает и без него.
      '/lmstudio': {
        target: 'http://localhost:1234',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lmstudio/, ''),
      },
    },
  },
})
