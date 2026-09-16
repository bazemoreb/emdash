---
"emdash": patch
---

Fixes `definePlugin()` so it accepts plugin descriptors returned by first-party factory functions such as `cloudflareEmail()`. The `PluginDescriptor` type is now aligned with `PluginDefinition`, and `SandboxedPluginDescriptor` keeps the manifest-style declarations used by `sandboxed: []` entries.
