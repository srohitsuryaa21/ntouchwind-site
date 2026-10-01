import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://ntouchwind.com',
  output: 'static',
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
});
