# ACL client

React/Vite client using the shared [design instructions](../DESIGN.md) and [migration guide](../MIGRATION.md).

## Run

Use Node.js 24, as in the main repository instructions.

```powershell
cd client
npm.cmd ci
npm.cmd run dev
```

Vite serves at `http://localhost:5173` and proxies `/api` to `http://localhost:3000`. Start the existing backend separately. Development proxy behavior is unchanged.

The signed-out root opens with a centered **Welcome to In-Your-Shed**, without the application header. Scroll Expand reveals the actual login/register form inside the expanded photo frame. Continue scrolling to light guest browsing. `/login` and `/register` jump to the expansion-complete account anchor. Other application screens retain navigation. `/items` is the standalone catalog with 300ms automatic search and dropdown filters. `/items/:id` has a borderless viewport-wide light gallery followed by dark details, with a centered wishlist action.

## Check

```powershell
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd test
```

Browser tests start Vite automatically and mock API responses. They do not need backend credentials or seed data. To use an already installed browser instead:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm.cmd test
```

Screenshots and failure traces go to ignored `test-results/`. `npm.cmd run test:ui` opens Playwright's interactive runner.

## Add a component or screen

Use semantic variables from `src/theme/theme.css`, CSS modules, Inter, and the existing components barrel. `Button` supports primary, secondary, ghost, and danger variants; sizes, pending, fullWidth, and disabled behavior; and route or anchor destinations. All variants have square corners. `FormField` wires labels, hints, and optional errors. `PageHeader` establishes screen hierarchy. `EmptyState`, `Message`, and `Spinner` cover feedback.

`Layout` stays light across routes. Use `PageSection` for full-width light/dark sections; theme changes should happen vertically as visitors scroll, not between routes or opposing side-by-side panels. Both explicit theme variants reset semantic values. Do not hardcode white panels inside components that may appear on dark sections.

The lazy-loaded liquid gallery uses OGL/WebGL 2. `PhotoGallery` owns keyboard/drag browsing, standard fallback, and inspection dialog. Triple-click an image to inspect, or press Enter with the gallery/photo focused. Visible carousel arrows and the inspect button are intentionally absent. Upstream changes belong in its vendor folder and must retain `LICENSE.md`. Local callbacks notify the wrapper of image errors and actual image hits for triple-click recognition.

Inter is bundled through `@fontsource-variable/inter`; runtime font loading does not depend on Google Fonts. The landing photo at `public/images/shared-gear.png` was generated with the built-in image-generation tool. Prompt: premium editorial product still life of a camera, cordless drill, and canvas camping gear on a charcoal workbench, neutral black background, warm amber side lighting, no people, text, or branding.

`components/scroll/WelcomeExpand` configures the licensed Scroll Expand JS/CSS source without another animation dependency. It uses native window scrolling, disables hidden overlay controls, provides matching account/guest scroll cues and keyboard skip links, and renders a static welcome for reduced motion. Its `fitContent` extension observes the form's natural height so long registration content grows the stage and scrolls with the window. Expansion progress is based on viewport height, not changing form height. Preserve query-only scroll position so guest searching never jumps to the top.

`AnimatedHeight` animates natural content changes without remounting forms. Account-panel route changes preserve scroll; direct account entry uses its anchor only on initial arrival. Catalog refreshes keep the previous grid mounted with an inline busy status. Keep these behaviors when adding filters or new account fields. The decorative gradient between dark entry and light guest browsing is controlled by the central theme and entry-page spacing.

Desktop registration widens from 32rem to 44rem and uses two columns; mobile stays in one column. `GuestIntroduction` applies the actual React Bits Scroll Reveal effect to the three introduction lines inside a gradient at least one viewport tall. Its GSAP dependency is installed by `npm.cmd ci`; trigger positions refresh after layout changes settle, and reduced motion keeps the text readable without animation. Do not duplicate the introduction in the embedded catalog.
