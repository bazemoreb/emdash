---
"@emdash-cms/plugin-forms": patch
---

Fixes form webhook delivery so the outgoing request is anchored to the request lifetime and non-2xx responses are logged.

- Webhook calls are now deferred via `after()` so Cloudflare Workers can keep them running after the submission response is sent.
- Responses with 4xx/5xx status codes are logged as failures.
- Redirected webhook responses now log the final URL so silent redirect-to-login issues are visible.
