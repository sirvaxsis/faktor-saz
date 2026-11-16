# آیکون فاکتورساز

Artwork was created with the built-in image generation tool. PNG resizing and ICO encoding are mechanical exports using Pillow; the desktop source alpha is preserved.

- `app-icon-fullbleed.png`: opaque artwork for Android maskable icons and Apple touch icons.
- `app-icon-desktop.png`: rounded graphite tile with transparent corners for standard desktop icons and favicons.

Rebuild exports: install Pillow and run `python scripts/build-icons.py`.

The manifest retains its existing `id`, `start_url` and `scope`, so this is an icon update to the same installed application. Versioned asset filenames and a new service-worker cache version avoid reusing old icon responses. Existing installations may retain an OS/browser icon cache and need time to refresh or a reinstall.

References: [maskable icon guidance](https://web.dev/articles/maskable-icon), [Apple touch icon guidance](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).

## Original generation prompt

Use case: logo-brand. Create one premium production app icon for a Persian invoice-making application called Factor Saz. No typography, no letters, no words. Square 1024x1024 full-bleed composition. Deep midnight graphite background fills every pixel right to all four canvas edges, subtle elegant tonal gradient. In the exact center a bold clean stylized invoice/document emblem with a folded top corner and two short horizontal invoice strokes, integrated with a confident emerald/teal checkmark at its lower right. Modern refined fintech identity, carefully balanced geometric shapes, restrained dimensional depth, sharp edges, extremely legible at 32px. Emblem fits within the central 64 percent of canvas width and height so mobile mask cropping will not clip it. No outer rounded square boundary: the background is a complete unrounded square that the OS will mask. No white frame, no white border, no white outside margin, no surrounding mockup, no drop shadow beyond the canvas. A single centered symbol, polished and distinctive, dark graphite with luminous emerald and very pale mint document face. This is the actual icon asset, not a presentation of an icon on a background.

## Desktop edit prompt

Create the desktop / standard app-icon variant of this exact icon. Preserve the exact central invoice and emerald checkmark design, materials, proportions and colors. Place its existing dark graphite gradient background within a smoothly rounded square app tile that nearly fills the canvas, with only a very narrow fully transparent margin outside the tile and actually transparent corner cutouts. Genuine alpha transparency outside the rounded dark tile, no white pixels or white matte in the outer margin, no checkerboard drawn into the image. Keep the emblem centered and safely inset. Square high-resolution icon asset, not a mockup. Do not introduce text or change the logo.
