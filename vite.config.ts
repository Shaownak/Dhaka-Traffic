import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    // Three is dynamically imported by the street section; keep it in its own
    // chunk so the initial payload never carries it.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
});
