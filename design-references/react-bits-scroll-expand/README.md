# React Bits Scroll Expand reference

Retrieved 2026-11-15 from [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits/tree/main/src/content/Animations/ScrollExpand), JavaScript + CSS variant corresponding to `@react-bits/ScrollExpand-JS-CSS`.

- JSX blob: `8e14bbdd8bc085e43bc9fe93ff2da00f752cea2f`.
- CSS blob: `0bd0b5ef3282fbbe78f7d7ba4dc64e3f117e56d6`.
- This directory preserves the original files. The client copy is in `client/src/components/scroll/vendor/`.
- License: MIT + Commons Clause; retain the included LICENSE.md with the component.

The actual source uses a sticky stage, scroll progress, a clip-path expanding from an inset rounded frame to full bleed, media zoom, title fade-out, and an overlay fade-in. It supports window scrolling without an additional animation dependency.

The local client adaptation makes unrevealed overlay controls inert/hidden to assistive technology and sizes the stage to its inline form content. `WelcomeExpand` wraps the real effect with the project palette, a centered In-Your-Shed welcome, and a static reduced-motion fallback. The expanded frame contains real login/register fields; the stage grows for longer registration content while preserving native window scrolling. A marker at the expansion-complete offset supports account links. The guest catalog follows the animation track. The entry header is hidden.
