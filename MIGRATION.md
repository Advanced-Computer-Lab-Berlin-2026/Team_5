# Frontend migration: Porcelain + black

This migration establishes the frontend foundation for the current sprint and later project increments. It preserves the existing backend API and role permissions. It does not implement future booking, payment, chat, or recommendation functionality.

Status: steps 1-6 complete; production and browser validation complete as recorded below. This is a migrated foundation, not a claim that the remaining project functionality is finished.

## Implementation steps

1. **Shared foundations:** centralized semantic light/dark tokens, locally hosted Inter, sharp buttons, form controls, cards, feedback, tables, loading, spacing, and reduced-motion behavior.
2. **Application shell:** responsive role-aware navigation, accessible mobile menu, skip link, footer, shared page headers, and vertical section themes. The shell remains light across routes. Dark login flows into light guest browsing; light item photos flow into dark details.
3. **Compound entry:** headerless centered In-Your-Shed welcome; actual Scroll Expand reveals real login/register fields inside the frame; continued native scrolling reaches the guest catalog. The stage grows for registration. Direct account links skip the welcome. Preserve registration fields, username login, password recovery, query filters, post-login return destinations, and guest scroll position.
4. **Discovery:** photo-led item cards, real API categories in a dropdown, 300ms automatic search, URL-based filters, retry and empty states, member catalog, and wishlist reuse.
5. **Item inspection:** actual React Bits liquid-lens source, borderless viewport-wide item gallery, keyboard/drag browsing, standard/reduced-motion/no-WebGL/error fallback, and native-dialog inspection opened by triple-click or keyboard. No visible carousel arrows or inspect button. Center wishlist below the divided detail rows.
6. **Existing workflows:** apply the shared system to wallet, household, profile, notices, lender verification, item management/uploads, and admin tables/forms without replacing their API operations.
7. **Validation and handoff:** production build, mocked-API browser flows, narrow-screen checks, screenshots, and documentation. See validation record below.

## Current architecture

| Location | Responsibility |
| --- | --- |
| `DESIGN.md` | Current visual decisions, component rules, and implementation defaults |
| `client/src/theme/theme.css` | Semantic colors, typography, spacing, and light/dark values |
| `client/src/theme/routes.js` | Safe login destination policy |
| `client/src/components/PageSection.jsx` | Explicit light/dark sections that transition as visitors scroll |
| `client/src/components/` | Reusable controls and compositions |
| `client/src/components/auth/` | Login/register forms with existing API contracts |
| `client/src/components/gallery/vendor/` | React Bits source, local adaptation, and original license |
| `client/src/components/scroll/` | WelcomeExpand composition and licensed Scroll Expand source |
| `client/src/components/scroll/GuestIntroduction.jsx` | Licensed GSAP Scroll Reveal introduction inside the tall gradient |
| `client/src/components/AnimatedHeight.jsx` | Reusable natural-content height transitions without remounting forms |
| `client/src/pages/` | Screen composition and existing feature orchestration |
| `client/src/api/` | Existing HTTP contracts; unchanged by this migration |
| `client/tests/` | Browser regression flows with isolated API fixtures |

## Extension rules

- Reuse the existing components before adding alternatives. Keep business operations in API modules and page/feature logic, not generic controls.
- Add new semantic tokens to the centralized theme, including dark equivalents where required. Never make dark pages navy by default.
- All button variants retain square corners. Cards and images may use their separate radius tokens.
- Use `PageHeader`, `Card`, `Grid`, `Row`, `FormField`, `Message`, and `EmptyState` to compose new screens.
- Use `ItemCard` for catalog-style listings. Use `PhotoGallery` for multiple views of a single item.
- Add new destinations to the role-aware navigation and route policy deliberately. Preserve protected routes.
- Account for loading, empty, retry/error, keyboard focus, long content, small screens, and reduced motion with each increment.
- Keep upstream license notices. The carousel's source reference is recorded in `design-references/react-bits-flex-carousel/README.md`.
- Generated landing artwork is illustrative brand photography, not a real listing or claim about availability.

## Validation record

- `npm.cmd run build`: production build passes; Inter assets are local and the WebGL renderer is emitted as a separate lazy-loaded chunk.
- `npm.cmd test`: **22 Chromium browser tests pass**. Coverage includes compound guest/auth browsing and query preservation, registration payloads, guest wishlist return and single save, real WebGL canvas, edge-to-edge photo layout, keyboard browsing, triple-click inspection, standard/reduced-motion/no-photo fallbacks, broken texture recovery, failed login without refresh, catalog retry/empty states, 300ms debounce and collapsed filters, vertical section themes, centered wishlist and divided detail rows, member/lender/admin navigation, mobile fit, logout, actual welcome-frame expansion, inline account forms, hidden entry header, direct-account anchors, long expanded registration on mobile, reduced-motion welcome behavior, smooth account resizing with preserved values/scroll, mounted results during delayed search responses, two-column registration with mobile reflow, and scroll-revealed introduction in the taller gradient.
- Desktop entry, dark item-detail/liquid-gallery, and mobile wishlist screenshots were inspected. Screenshot data comes from isolated test fixtures, not real listings. Outputs are in ignored `client/test-results/`.
- Browser fixtures isolate UI behavior. A live backend with MongoDB, SMTP, actual cookie sessions, real uploads, and Cloudinary delivery has not been exercised in this environment. Existing API contracts were retained; this is not a backend integration certification.
- Exact live-demo slider settings were not recovered. The original lens implementation is in use and tested; artistic tuning can continue on the running gallery.

## Later increments

The migrated frontend remains extensible for the rest of the project. Future functionality should build on this design system. Exact animation tuning against the reference demo and any further visual refinements can be reviewed on the running app. Do not interpret the approximate project completion percentage as evidence that future backend features exist.
