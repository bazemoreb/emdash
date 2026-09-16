import { definePlugin } from "emdash";

import { cloudflareEmail } from "../../src/plugins/cloudflare-email.js";

// Regression test for #2311: wrapping a first-party provider descriptor in
// definePlugin() should typecheck. The Astro integration's `plugins: []` needs
// a bundlable entrypoint, so a local plugin that re-exports the provider via
// definePlugin() is a supported composition pattern.
export function createPlugin() {
	return definePlugin(
		cloudflareEmail({
			from: { email: "no-reply@example.com", name: "Example" },
			binding: "EMAIL",
		}),
	);
}

export default createPlugin;
