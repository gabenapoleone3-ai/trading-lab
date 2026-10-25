import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({root:resolve('extension'),base:'./',plugins:[react()],build:{outDir:'build',emptyOutDir:true,rollupOptions:{input:{panel:resolve('extension/panel.html'),options:resolve('extension/options.html')}}}});
