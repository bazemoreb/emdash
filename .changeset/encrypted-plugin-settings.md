---
"emdash": minor
"@emdash-cms/cloudflare": minor
"@emdash-cms/sandbox-workerd": minor
"@emdash-cms/plugin-test": minor
"@emdash-cms/plugin-cli": patch
"create-emdash": patch
---

Adds `ctx.settings` for plugin configuration and encrypts fields declared as `type: "secret"` before writing them to the database. Native plugins, Cloudflare Worker Loader plugins, and Node/workerd plugins share the same versioned AES-GCM envelope and plugin-scoped API. `@emdash-cms/plugin-test` can update generated settings through the runtime host and inspect their raw persisted envelope.

Set `EMDASH_ENCRYPTION_KEY` before saving secret settings. To rotate it, place the new key first in a comma-separated list and retain old keys until every plugin secret has been saved again. Restores need both the database and every encryption key referenced by its stored envelopes.

Existing Cloudflare sites must add `nodejs_compat_populate_process_env` to `compatibility_flags` before saving secrets through the generated admin form. New Cloudflare templates include the flag.

Existing plaintext secrets remain readable and are encrypted when saved again. The `ctx.kv.get("settings:<key>")` compatibility alias remains available throughout the EmDash 0.x release line; new plugin code should use `ctx.settings.get("<key>")`.
