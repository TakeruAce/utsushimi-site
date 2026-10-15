// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://utsushimi.co.jp',
  integrations: [sitemap({ filter: (page) => {
    const pathname = new URL(page).pathname;
    return !pathname.startsWith('/design-lab') && !/^\/landing(?:\/|$)/.test(pathname);
  } })],
  vite: {
    plugins: [tailwindcss()],
  },
});
