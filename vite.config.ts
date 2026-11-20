import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/**
 * Strips development-only AI Studio paste/scratch artifacts from the production `dist/`
 * bundle after Vite copies `public/`, while preserving original files untouched in `public/`.
 */
function excludeDevOnlyPublicAssets(): Plugin {
  let resolvedOutDir = path.resolve(__dirname, 'dist');
  return {
    name: 'gp-exclude-dev-only-public-assets',
    apply: 'build',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir || 'dist');
    },
    closeBundle() {
      const devOnlyDir = path.join(resolvedOutDir, 'assets', 'aistudio');
      if (fs.existsSync(devOnlyDir)) {
        fs.rmSync(devOnlyDir, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), excludeDevOnlyPublicAssets()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: 'chrome109',
      cssTarget: 'chrome109',
      sourcemap: false,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vendor-react', test: /node_modules\/(react|react-dom|scheduler)/ },
              { name: 'vendor-icons', test: /node_modules\/lucide-react/ },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
