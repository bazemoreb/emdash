---
"emdash": patch
---

Rebuilds the `emdash` bundle against `@emdash-cms/registry-verification` 0.3.1 so the inlined `createRequire` shim uses a Windows-valid synthetic file URL. `emdash@0.37.0` carried its own copy of the driveless `file:///emdash-registry-verification.js` URL, which failed on Windows during Astro config loading.
