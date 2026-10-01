import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://www.ntouchwind.com',
  output: 'static',
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
});
