# N Touch Wind Services, website (next)

Astro + TypeScript + GSAP ScrollTrigger + Lenis smooth scroll + Three.js. Static output. Same stack as rohitsuryaa.com.

## Run

```bash
npm install
npm run dev      # http://127.0.0.1:4321/
npm run build    # astro check + build + link checker
```

Every push to `main` is built and published to GitHub Pages at www.ntouchwind.com by `.github/workflows/deploy.yml`.

## Home page sequence

1. **Loader.** Counts 0 to 750 kW while the 3D scene loads. Shorter on repeat visits; a CSS failsafe hides it after 7 s.
2. **Scene (pinned): hero + "turbine comes alive".** The page opens on the Three.js scene (`src/scripts/turbine.ts`), modelled on the real 250 kW lattice tower turbines, at night with a moon behind the rotor. The headline sits over it. Scrolling dives the camera onto the hub, then four chapters: 250 kW, all three turbines (750 kW), aerial with power flowing to a client factory (B2B), sunrise (100% clean). Rotor speed follows scroll speed; the camera drifts with the mouse. HUD tracks capacity and chapter.
3. **About.** Intro sentence fills word by word, founder portrait, years counter.
4. **Mission and vision (pinned).** Year odometer rolls 2026 to 2030 while a 50 square capacity grid (50 kW a square) fills from 750 kW today to 2.5 MW; mission text hands over to vision.
5. **Values (pinned): rotor of values.** Three blades, three values. The rotor turns 120 degrees per value and snaps to the nearest one; the blade pointing at the copy lights up in sky, sun or leaf.
6. **Services: power path.** A cable is drawn down the section with a glowing pulse; each of the four stations switches on with its own animated drawing as the pulse reaches it, ending at "your business".
7. **On site.** Real site photo, clip reveal.
8. **Solar expansion (pinned 3D, `src/scripts/solar.ts`).** An empty plot with a dashed boundary, tracker rows rising row by row (1 MW), turning east to face the sun, three planned turbines rising as blue holograms beside our three on the ridge (+750 kW), then power running from the rows to the inverter and out (2.5 MW). The three figures switch on as the story reaches them. Sunrise in night mode, full day in day mode. The solar photo is the fallback.
9. **Contact.** mailto form (nothing is sent automatically), footer.

`/wind-turbine-maintenance` keeps the existing guide page (it is in the sitemap).

Reduced motion: no loader, no pins, no WebGL; hero photo, chapters as a list, all services shown switched on.

## Day and night mode

A sun/moon button in the header switches themes; the choice is kept in localStorage (`ntw-theme`) and applied before paint by the inline script in `Layout.astro`. Night is the default. Colours are CSS tokens on `:root` with a `:root[data-theme='light']` override. The 3D scene has one time-of-day value (0 night, 0.5 sunrise or sunset, 1 day): night mode runs night to sunrise in the last chapter, day mode runs the story in reverse, from full daylight through sunset to night.

## Files

- `src/pages/index.astro`: home markup and copy.
- `src/pages/wind-turbine-maintenance.astro`: guide page.
- `src/components/Layout.astro`: head, SEO, header, mobile menu.
- `src/styles/site.css`: all styles. Palette from the logo: sky `#22b2ea`, sun `#ffd23f`, leaf `#3dbb5c` on night navy `#04080e`.
- `src/scripts/site.ts`: all scroll motion.
- `src/scripts/turbine.ts`: the wind 3D scene (also exports the lattice tower, blade and glow helpers).
- `src/scripts/solar.ts`: the solar 3D scene.

## Writing

Visible copy uses no dashes as punctuation and should read plainly.
