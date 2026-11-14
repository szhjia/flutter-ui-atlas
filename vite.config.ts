import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath, URL} from 'node:url';

export default defineConfig(({command}) => ({
  plugins: [react(), tailwindcss()],
  publicDir: command === 'build' ? false : 'public',
  resolve: {
    alias: {'@': fileURLToPath(new URL('./packages/viewer/src', import.meta.url))},
    dedupe: ['react', 'react-dom', '@xyflow/react']
  },
  build: {rolldownOptions: {input: {viewer: 'index.html', config: 'config.html'}}}
}));
