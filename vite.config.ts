import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// https://vitejs.dev/guide/build
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      plugins: [react()],
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'PdfToDxf',
          formats: ['es', 'cjs'],
          fileName: (format) =>
            `pdf-to-dxf.${format === 'es' ? 'mjs' : 'cjs'}`,
        },
        rollupOptions: {
          external: ['react', 'react-dom', 'react/jsx-runtime'],
          output: {
            globals: {
              react: 'React',
              'react-dom': 'ReactDOM',
            },
          },
        },
        outDir: 'dist',
        emptyOutDir: true,
      },
    };
  }

  if (mode === 'cli') {
    return {
      build: {
        lib: {
          entry: resolve(__dirname, 'src/cli/index.ts'),
          formats: ['es'],
          fileName: () => 'cli.mjs',
        },
        rollupOptions: {
          external: [
            'node:fs',
            'node:path',
            'node:url',
            'pdfjs-dist',
            '@tarikjabiri/dxf',
          ],
        },
        outDir: 'dist',
        emptyOutDir: false,
        target: 'node18',
      },
    };
  }

  return {
    plugins: [react()],
    base: mode === 'ghpages' ? '/pdf-to-dxf/' : '/',
    publicDir: resolve(__dirname, 'public'),
    build: {
      outDir: 'dist-demo',
      emptyOutDir: true,
    },
  };
});
