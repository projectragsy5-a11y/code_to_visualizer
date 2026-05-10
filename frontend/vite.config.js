import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/auth': 'http://localhost:8000',
      '/run': 'http://localhost:8000',
      '/visualize': 'http://localhost:8000',
      '/scan-inputs': 'http://localhost:8000',
      '/activities': 'http://localhost:8000',
      '/submissions': 'http://localhost:8000',
      '/flowchart': 'http://localhost:8000',
      '/admin': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    }
  }
})