import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({command}) => ({
  plugins: [react()],
  publicDir: command === 'build' ? false : 'public',
  resolve: {dedupe: ['react', 'react-dom', '@xyflow/react']},
  build: {rolldownOptions: {input: {viewer: 'index.html', config: 'config.html'}}},
}));
