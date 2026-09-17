---
"emdash": patch
---

Fixes Node adapter builds failing with "Rollup failed to resolve import "cloudflare:sockets"" from registry artifact transport code.

The Vite configuration now externalizes all `cloudflare:*` built-ins on non-Cloudflare adapters, both in SSR (`ssr.external`) and in the Rollup build pass (`build.rollupOptions.external`). This prevents bundled `emdash` code from tripping Rollup during `astro build`, while still letting the actual dynamic import fall back to the Node transport at runtime. Cloudflare builds are unchanged because the adapter handles its own built-in externalization.
