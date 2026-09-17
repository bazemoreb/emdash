import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	WorkerEntrypoint: class {
		ctx: unknown;
		env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

import { PluginBridge } from "../../src/sandbox/bridge.js";

function makeBridge(capabilities: string[]) {
	return new PluginBridge(
		{
			props: {
				pluginId: "media-test",
				pluginVersion: "1.0.0",
				capabilities,
				allowedHosts: [],
				storageCollections: [],
			},
		} as never,
		{ DB: {} } as never,
	);
}

describe("PluginBridge media capability separation", () => {
	it("does not grant byte or metadata mutation authority with media:read", async () => {
		const bridge = makeBridge(["media:read"]);
		await expect(bridge.mediaReadBytes("media-1")).rejects.toThrow(
			"Missing capability: media:bytes:read",
		);
		await expect(bridge.mediaUpdateMetadata("media-1", { alt: "Changed" })).rejects.toThrow(
			"Missing capability: media:metadata:write",
		);
	});

	it("does not grant metadata reads with media:bytes:read", async () => {
		const bridge = makeBridge(["media:bytes:read"]);
		await expect(bridge.mediaGet("media-1")).rejects.toThrow("Missing capability: media:read");
		await expect(bridge.mediaList()).rejects.toThrow("Missing capability: media:read");
	});
});
