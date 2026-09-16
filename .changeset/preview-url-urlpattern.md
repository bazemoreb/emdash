---
"emdash": patch
---

Fixes the admin "Preview draft" / "View on site" link so it respects each collection's `urlPattern` instead of always generating `/{collection}/{id}`.

Collections with custom routes (for example `urlPattern: "/lp/{slug}"`) now produce preview URLs that match the site's canonical URLs. The `EMDASH_PREVIEW_PATH_PATTERN` environment variable and the default `/{collection}/{id}` pattern still apply when a collection has no `urlPattern` configured.
