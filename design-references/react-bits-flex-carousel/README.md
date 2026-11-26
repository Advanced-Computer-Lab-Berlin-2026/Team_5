# React Bits Flex Carousel source reference

Retrieved 2026-11-15 from DavidHDev/react-bits, main branch, JavaScript + plain CSS variant. This folder preserves the inspection snapshot, not the client's working copy.

Update: this folder remains the original snapshot. The subsequently authorized migration integrated a separate client copy under `client/src/components/gallery/vendor/`, installed OGL, and added the shared `PhotoGallery` wrapper. The client copy adds an image-error callback. Refer to `MIGRATION.md` for current validation rather than the original inspection-only status below.

- [Component page](https://reactbits.dev/components/flex-carousel)
- [JSX source](https://github.com/DavidHDev/react-bits/blob/main/src/content/Components/FlexCarousel/FlexCarousel.jsx)
- [CSS source](https://github.com/DavidHDev/react-bits/blob/main/src/content/Components/FlexCarousel/FlexCarousel.css)
- [Upstream license](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md), included here as LICENSE.md. Retain its notice with reused source.
- Upstream JSX blob: `32e1de8f54e9c566d667228fa653fd2ffff1056d`.
- Upstream CSS blob: `9c3efa189879d673f54eba2183b152bde2a48a7f`.

Files preserve fetched source text; trailing newline normalization may differ. Default demonstration photographs and labels remain upstream examples, not ACL assets.

## Source inspection findings

- React component using `ogl`; shaders require WebGL 2. The client does not currently declare `ogl`.
- Two-stage rendering: image cards render into a texture, then a lens shader displaces and disperses that rendered scene. This is actual distortion, not a frosted overlay.
- Presets: liquid, ribbon, vortex, arch. Default is liquid; exact live-demo customization settings were not recovered or visually verified.
- Default intro is rise; autoplay is false; focusOnClick and captureWheel are true.
- Source includes drag/touch handling, wheel input, spring snapping, keyboard controls, click-to-focus, captions, and an animated count.
- Reduced-motion logic exists. Unsupported-WebGL and failed-image fallback behavior still needs assessment for ACL; the WebGL 2 check returns without providing a replacement photo gallery.
- No browser runtime or visual verification has been performed. Importing these files alone is not an implemented or tested gallery.

## Planning requirements

Preserve the real lens effect and interaction when implementing. Decide settings through a live preview, not generated still images. Use ACL item photos rather than the bundled sample list. Define zero/one-photo handling, readable captions, focus styling, manual browsing, page scrolling, reduced motion, and an undistorted inspection/fallback view before accepting the component. Arrow/dot controls in earlier mockups are proposed additions, not source features.
