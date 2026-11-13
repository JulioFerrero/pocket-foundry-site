// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://pocketfoundry.dev',
  trailingSlash: 'always',
  // The CSS goes in each page rather than a file it waits for: one less request before the first paint.
  build: { format: 'directory', inlineStylesheets: 'always' },
  devToolbar: { enabled: false },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({ i18n: { defaultLocale: 'en', locales: { en: 'en' } } }),
  ],
});
