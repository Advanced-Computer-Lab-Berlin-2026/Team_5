# ACL shared frontend design instructions

Status: **Frontend foundation migrated.** Porcelain A, neutral black dark pages, A: Sharp buttons, and Inter are selected. Shared components are implemented; further visual refinements can be discussed and added here.

This is the source of truth for both teammates and future frontend sessions. Read this document and [MIGRATION.md](MIGRATION.md) before changing the client. Values marked **selected** come from user decisions. Other details are **implementation defaults** chosen during the authorized migration and remain open to refinement.

## Selected direction

- Rich editorial browsing inspired by the experience of Apple Music: photography, clear hierarchy, depth, and polished interaction. This is ACL's design, not an official Apple palette.
- Porcelain/white light sections and neutral black/charcoal dark sections. Theme changes occur vertically while scrolling between sections, not by switching routes or side-by-side light/dark panels. Dark foundations must not become navy or blue-tinted black.
- Amber primary actions; cobalt as a supporting accent.
- A: Sharp rectangular buttons, flat fills, 0px radius.
- Inter throughout, with system sans-serif fallbacks.
- One compound landing page: In-Your-Shed welcome expansion, login/register, then guest browsing below.
- Actual React Bits Flex Carousel lens effect for multiple photographs of one item.

Earlier palette, pill-button, and separate marketing-landing proposals are superseded. Do not reintroduce them from old concept images.

## Selected core palette

| Role | Hex | Use |
| --- | --- | --- |
| Porcelain | `#FAF8F4` | Light page background |
| White | `#FFFFFF` | Light cards/forms; primary text on dark |
| Ink | `#141414` | Light-page text; dark-page foundation; text on amber |
| Amber | `#F3A348` | Primary actions and warm highlights |
| Cobalt | `#356AE6` | Category selection and cool accents |
| Slate | `#626977` | Secondary text on light surfaces |

Navy `#14294A` belonged to the original Porcelain study. It is retained only as historical reference, not as a current dark surface token. Any future decorative use needs a new decision.

### Implemented supporting tokens

`client/src/theme/theme.css` holds all semantic colors and theme values. Use its variables rather than copying hex values into components.

| Role | Light default | Dark default |
| --- | --- | --- |
| Page | Porcelain | Ink |
| Raised surface | White | `#242424` |
| Subtle surface | `#F0EDE7` | `#1B1B1B` |
| Primary text | Ink | White |
| Secondary text | Slate | `#B3B3B3` |
| Strong control border | `#8B8B86` | `#8A8A8A` |
| Decorative separator | `#D9D6CF` | `#393939` |
| Link | Cobalt | `#91B0FF` |
| Keyboard focus | Cobalt | `#91B0FF` |
| Disabled fill | `#E2DFD8` | `#353535` |
| Disabled text | `#626262` | `#A6A6A6` |
| Error text / fill | `#A92C2C` / `#FFF0EF` | `#FFB6AE` / `#381F1D` |
| Success text / fill | `#256546` / `#EDF6EF` | `#A4DBB7` / `#1D3024` |

Amber hover is `#E99432`; pressed is `#DC8526`. These and supporting colors are implementation defaults, not additional palette choices made by the user. Semantic colors communicate state; they are not decorative category colors.

Keep ordinary text, forms, and tables on solid surfaces. Restrict optional gradients to feature artwork; the current feature treatment is a neutral black base with a restrained amber glow. Photographs may contain natural colors beyond the UI palette. Keep meaningful state cues identifiable beyond color alone.

## Typography and geometry

**Selected:** Inter, bundled locally through `@fontsource-variable/inter`. Do not mix in the earlier font candidates or rely on an external font service at runtime.

Implementation defaults:

- Weights: 400 regular, 500 medium, 650 emphasis/headings.
- Body: 15px; secondary labels: 13px; larger section headings: 20px.
- Page headings: responsive 32-48px; feature display: responsive 40-76px.
- Base line height: 1.6; heading line height: 1.2.
- Spacing tokens: 4, 8, 16, 24, 32, 48, 72px.
- Maximum content width: 80rem.
- Standard control minimum height: 46px; compact button minimum: 40px.
- Buttons: 0px radius; inputs/category controls: 4px; cards: 12px; media: 8px.

Square button corners do not require every card or image to be square. Refine geometry through tokens and shared styles rather than creating a different scale on each screen.

## Coordinated page treatments

Use full-width vertical sections to establish the treatment. The application shell stays light across routes. Do not change an entire route to dark or place opposing light/dark panels beside each other.

| Screen | Current treatment |
| --- | --- |
| Welcome | Dark, actual React Bits Scroll Expand media frame with In-Your-Shed title |
| Expanded login/registration | Real form inside the full-bleed welcome frame; dark form surface over photography |
| Guest catalog below entry | Porcelain |
| Member catalog and wishlist | Porcelain |
| Item photos | Light, borderless, viewport-wide gallery |
| Item details below photos | Neutral black/charcoal section, centered wishlist action underneath |
| Wallet, household, profile, notices | Porcelain |
| Password recovery and change password | Porcelain |
| Lender and admin management | Porcelain |

Use `PageSection` with an explicit light or dark theme. Both themes define their semantic values so nested light sections reset correctly. `client/src/theme/routes.js` only defines login destinations; it no longer chooses a page theme. Navigation remains consistent across routes. A theme toggle is not implemented or requested.

## Component rules

### Buttons and links

**Selected:** A: Sharp, rectangular, flat, square corners. No pill shapes, chamfers, decorative gradients, or raised shadows for button controls.

| Variant | Light | Dark |
| --- | --- | --- |
| Primary | Amber fill, Ink text/icons | Same |
| Secondary | White fill, Ink text/icons/outline | Transparent black surface, White text/icons/outline |
| Ghost | Transparent, Ink text | Transparent, White text |
| Danger | Semantic error fill/text/border | Corresponding dark error tokens |
| Text link | Cobalt | Light-blue link token |

Shared `Button` supports route links, anchor links, compact/default sizes, full width, pending, and disabled states. Disabled links must not remain navigable. Primary hover/press uses the central amber tokens; secondary hover inverts its foreground/background. Use a visible focus outline, keep loading labels understandable, and label icon-only controls.

### Navigation and page structure

Use `Layout`, `Nav`, `AdminLayout`, and `PageHeader`. Preserve member/lender/admin destinations and protected routes. Mobile navigation uses a labeled expandable menu. Use the skip link and a meaningful heading on each screen. `FeatureBanner` is optional emphasis, not a prerequisite for accessing content.

### Cards, catalog, and feedback

- `Card` is the generic reading/form surface; supports title, body, footer, and className.
- `ItemCard` is the photo-led listing composition, reused by catalog and wishlist. Use real item data and a clear unavailable-photo placeholder.
- `Grid` and `Row` provide responsive composition.
- Search runs automatically after approximately 300ms without typing; no Search items button. Cancel pending timers on further input, navigation, and unmount; wait for IME composition to finish. Enter may submit immediately. Search updates replace history entries.
- Category options live inside a downward-opening Filters dropdown, not a permanently displayed row. Keep the selected-filter count visible; support outside-click and Escape dismissal. Filters and search stay in URL parameters and can be reloaded/shared. Guest browsing requires no separate mode activation.
- During search refreshes, keep the existing result grid mounted until the new response arrives. Show an inline Updating results status rather than replacing the grid with a spinner. Reserve results/control space so typing does not collapse the document, move the search field, or reset focus and scroll.
- Detail rows have a vertical divider between their label and value columns, including on narrow screens.
- Use `EmptyState`, `Spinner`, and `Message` for clear empty/loading/error/success states. Keep retry controls available when a read fails.
- Use `Table` for management data, with scoped headings and contained horizontal overflow.

### Forms

Use `FormField`, `Input`, `Select`, `TextArea`, `FileField`, and `FileUploadCard`. Associate labels, hints, and errors with controls. Preserve existing server payloads, validation requirements, upload limits, and authentication behavior. Username remains the login identifier. Registration keeps username, name, email, password, optional phone, and optional address.

Desktop registration uses two columns in three rows: Username / Full name; Email / Password; Phone / Home address. Below 760px, use one column in the same reading/tab order. Keep the submit action full width.

### Item photo Flex Carousel

**Selected requirement:** preserve the actual lens effect from [React Bits Flex Carousel](https://reactbits.dev/components/flex-carousel). Generated static images are not a motion specification.

- Original extracted reference: `design-references/react-bits-flex-carousel/`.
- Integrated source/license: `client/src/components/gallery/vendor/`.
- Shared wrapper: `PhotoGallery`; lazy-load the OGL/WebGL 2 renderer.
- Implementation defaults: liquid preset, fade intro, natural photo aspect, 8px photo radius, manual browsing, autoplay off, click-to-focus off, vertical wheel capture off.
- Item-page gallery spans to both viewport edges, with no outer border or rounded container. Image corners remain independent of the container treatment.
- Keep photo count, drag/keyboard browsing, and a standard-gallery fallback. Remove visible previous/next carousel buttons and the Inspect photo button.
- Three consecutive clicks on the same image within 500ms between clicks open its undistorted inspector. Do not open inspection after one or two clicks or when dragging. Keyboard users can press Enter on the focused gallery/photo to inspect.
- Zero photos show an empty state. One photo uses a standard image. Reduced motion and unavailable WebGL use the standard gallery.
- Texture failures notify the wrapper and fall back to normal images; broken normal images have a placeholder. Do not leave visitors with an unusable canvas.
- The native-dialog inspector shows the clicked original photo with `object-fit: contain`, keyboard dismissal, and clear navigation within the dialog. Its selected photo is independent of ongoing carousel motion.
- Retain the upstream license notice. The local source adaptation adds image-error and actual image-hit callbacks; preserve the real shader mechanism.

The actual effect is implemented; exact custom settings from the live reference demo were not recovered. Further tuning should be judged in the running gallery.

## Compound entry behavior

**Selected structure:** signed-out `/`, `/login`, and `/register` share the same compound page in this order:

1. Welcome to **In-Your-Shed**, centered in the initial viewport without the application header. The actual React Bits Scroll Expand image opens from an inset rounded frame to full bleed as the visitor scrolls.
2. The expanded frame reveals the actual login/register form in place of the welcome title. Do not insert an intermediate Log in / Register button or a second account section.
3. Light guest catalog, reached by continuing to scroll or by an explicit guest anchor.

Login/Register switches retain the guest query filters and return destination. Registration success returns to login with a notice. Direct `/login` and `/register` routes skip the welcome to the account section; the root opens at the welcome. Query changes must not reset the current scroll position.

Switching between login and registration preserves both forms' values and the current scroll position. Use shared `AnimatedHeight` to animate the content height over 420ms with the theme's layout easing, alongside a restrained 260ms content reveal. Direct account entry may jump to its anchor once; changing the selected account panel must not re-run that jump. Reduced motion disables these transitions.

Animate account width with the same 420ms layout easing: login is up to 32rem; registration up to 44rem, capped by the available viewport width. The paired registration fields keep the vertical increase modest. Viewport resizing must preserve a fully expanded account rather than collapsing its interactive content.

Between the expanded dark frame and catalog controls, include a neutral black-to-Porcelain gradient at least one viewport tall, with a 44rem minimum. Fade the bottom of the photo into black before the gradient. The guest introduction belongs inside the lower, lighter part of this gradient; do not repeat it above the search controls. Leave 10svh below the introduction for breathing room. The gradient background is decorative; its text remains semantic and accessible.

### Guest introduction Scroll Reveal

- Use the actual React Bits `ScrollReveal-JS-CSS` source and GSAP/ScrollTrigger, with the original license retained under `client/src/components/scroll/reveal-vendor/`.
- Reveal these exact lines during downward scrolling: **Take a look around**; **Find your next possibility.**; **Browse freely. Log in when you find something worth saving.**
- The eyebrow and description are paragraphs; the main line is an h2. Keep screen-reader text continuous rather than reading isolated animation fragments.
- Current effect settings: word-based scrub, opacity 0.15 to 1, blur strength 4, no rotation, smoothing 0.15, complete by the text bottom reaching 45% of the viewport height. Typography and colors follow the shared palette.
- Reduced motion shows fully readable text without the animated blur/fade. Refresh trigger measurements after account resizing or other surrounding layout changes settle; do not reset scroll.

### Welcome Scroll Expand

- Use the real `ScrollExpand-JS-CSS` source, copied into `client/src/components/scroll/vendor/` with its license. The original reference is in `design-references/react-bits-scroll-expand/`.
- `WelcomeExpand` owns branding, the inline account content, and the reduced-motion fallback. Current settings: window scrolling, initial width 64%, height 62%, radius 20px to 0, 0.75 viewport scroll distance, 0.12 viewport hold, smoothing 0.06, media zoom 1.15.
- Use native window scrolling, not a nested hidden-scrollbar container or wheel interception. Upward scrolling reverses the expansion.
- The form is inside the expanded frame. Measure its natural height and grow the stage to fit registration or feedback content. Use viewport height for the expansion distance, independently of form height. A taller stage must scroll naturally with the window; do not introduce an inner form scrollbar.
- Keep the guest catalog after the expansion track. The expanded form has a Scroll to browse as guest cue matching the initial Scroll to open your shed cue; both also work as anchor links.
- The entry-page header is hidden for the whole welcome/account/guest experience. Keep the normal application header on other screens.
- Unrevealed overlay actions are inert and hidden to assistive technology. Keyboard shortcuts let visitors skip directly to account access or guest browsing.
- Native focus scrolling or a mobile keyboard must not collapse the form while editing. Hold the reveal during form interaction; explicit wheel/touch/navigation scrolling releases that hold so the animation can still reverse.
- Reduced motion uses a static welcome with direct links and no pinned animation track. Mobile layouts retain accessible forms and guest browsing.

Visitors can scroll normally to guest browsing, or use the Scroll to browse as guest anchor. No login, overlay dismissal, or guest activation is required to browse. Hidden auth forms must not enter the keyboard sequence. The account anchor is placed at the expansion-complete scroll offset so direct login/register routes reveal the real form rather than scrolling to the collapsed welcome.

Item-page wishlist action belongs centered below the complete details section, not beside it. Remove the explanatory guest-login paragraph; clicking the action still preserves the existing login-return behavior.

After login, honor an internal return destination such as a wishlisted item. Otherwise admins enter administration and members/lenders enter the catalog. Do not change permissions to force all roles into a member-only flow.

## Extending the system

1. Discuss the component or feature and record selected decisions here.
2. Distinguish user-approved choices from provisional implementation defaults.
3. Reuse shared components and semantic tokens before creating alternatives.
4. Record purpose, anatomy, colors by state, geometry, typography, mobile behavior, keyboard behavior, and acceptance criteria for substantial additions.
5. Revise the current specification when a decision changes; do not leave competing instructions.
6. Preserve existing API contracts and permissions unless a functional change is explicitly agreed.
7. Validate normal/large text contrast targets of 4.5:1/3:1, required control boundaries/state indicators at 3:1, visible focus, small screens, long content, and reduced motion.

Current migration and test results are recorded in [MIGRATION.md](MIGRATION.md). Runtime values in the centralized theme and the exact specifications here take precedence over generated concept-image colors.

## Decision log

- 2026-11-15: Selected Porcelain A from the Amber + Blue exploration.
- 2026-11-15: Requested the actual Flex Carousel effect and coordinated light/dark pages.
- 2026-11-15: Selected neutral black dark surfaces, A: Sharp buttons, and a combined authentication/guest entry page.
- 2026-11-15: Selected Inter throughout and authorized migration, reusable foundations, and reasonable defaults for remaining details.
- 2026-11-15: Requested 300ms automatic search, collapsed category filters, vertical section-based themes, borderless edge-to-edge gallery, triple-click inspection without visible carousel arrows/inspect action, centered wishlist below details, and vertical label/value dividers. Implemented and covered by browser checks.
- 2026-11-15: Requested actual Scroll Expand on the landing page: Welcome to In-Your-Shed, then account access, then guest browsing. Added licensed upstream source, reversible window-scroll expansion, account shortcuts, and a static reduced-motion fallback.
- 2026-11-15: Refined the reveal to contain real login/register fields, removed the intermediate CTA and separate account section, hid the entry header, centered the initial welcome, and added a matching scroll cue toward guest browsing. The stage grows for long forms.
- 2026-11-15: Added smooth account-panel height/content transitions, stable in-place search refreshes, and a spacious black-to-Porcelain gradient leading to guest browsing.
- 2026-11-15: Made desktop registration a two-column form with smooth horizontal/vertical expansion. Added actual Scroll Reveal to the three guest-introduction lines inside a taller gradient.
