# React Bits Scroll Reveal reference

Retrieved 2026-11-15 from [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits/tree/main/src/content/TextAnimations/ScrollReveal), JavaScript + CSS variant corresponding to `@react-bits/ScrollReveal-JS-CSS`.

- JSX blob: `e52b2d188cababdd9ef698e44d4206fa3d124e08`.
- CSS blob: `45065800c5385139dcd59e33165feb2b5be05f90`.
- This directory preserves the original files and included license. The working copy lives in `client/src/components/scroll/reveal-vendor/`.
- The actual effect uses GSAP/ScrollTrigger to scrub word opacity and blur with scroll progress. GSAP is declared in the client dependencies.

The client adaptation supports a semantic `as` tag so the eyebrow/description remain paragraphs and the main line remains an h2. Paragraphs include screen-reader text while visual word fragments are hidden from assistive technology. The animation algorithm is retained. `GuestIntroduction` styles the text and refreshes trigger positions after surrounding layout settles. Upstream reduced-motion handling leaves text fully readable without animation.
