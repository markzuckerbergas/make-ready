import { defineConfig } from 'vite';

// base must match the GitHub Pages subpath (github.io/make-ready/)
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/make-ready/' : '/',
});
