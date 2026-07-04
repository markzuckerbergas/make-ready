import { defineConfig } from 'vite';

// base: GitHub Pages serves from /make-ready/; itch.io needs relative paths
export default defineConfig({
  base: process.env.ITCH ? './' : (process.env.GITHUB_ACTIONS ? '/make-ready/' : '/'),
});
