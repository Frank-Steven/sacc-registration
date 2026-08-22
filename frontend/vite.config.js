import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // 开发期 API 请求转发至宿主服务
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
