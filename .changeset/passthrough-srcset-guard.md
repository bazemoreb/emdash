---
"emdash": patch
---

Fixes `<Image>` and Portable Text `image` blocks so they no longer emit a `srcset` of identical URLs when Astro's configured image service is a passthrough.

When a local image has known dimensions, the components previously handed the URL directly to `<AstroImage>`, which produced width descriptors pointing at the same unresized file on services that cannot optimize the source. They now probe the image service first and fall back to a plain `<img>` when the service returns the URL unchanged, matching the behavior already used for images without stored dimensions.
