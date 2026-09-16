/**
 * Preview URL generation respects the collection's stored `urlPattern`.
 *
 * Regression: issue #2688. The admin "Preview draft" link was always built
 * from `/{collection}/{id}` (or the env override), ignoring per-collection
 * patterns like `/lp/{slug}`. This suite asserts that a configured pattern
 * drives the preview path and that the legacy fallback still works when no
 * pattern is set.
 */

import { Role } from "@emdash-cms/auth";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as postPreviewUrl } from "../../../src/astro/routes/api/content/[collection]/[id]/preview-url.js";
import type { Database } from "../../../src/database/types.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { createTestRuntime, handlersFromRuntime } from "../../utils/mcp-runtime.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

const editorUser = { id: "u-editor", role: Role.EDITOR };

function apiContext(
	request: Request,
	emdash: ReturnType<typeof handlersFromRuntime>,
	collection: string,
	id: string,
): APIContext {
	const url = new URL(request.url);
	return {
		params: { collection, id },
		url,
		request,
		locals: {
			user: editorUser,
			emdash,
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub for route tests
	} as unknown as APIContext;
}

describe("POST /_emdash/api/content/:collection/:id/preview-url", () => {
	let db: Kysely<Database>;
	let emdash: ReturnType<typeof handlersFromRuntime>;

	beforeEach(async () => {
		process.env.EMDASH_PREVIEW_SECRET = "test-preview-secret-for-route-tests";
		db = await setupTestDatabase();
		const runtime = createTestRuntime(db);
		emdash = handlersFromRuntime(runtime);
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
		delete process.env.EMDASH_PREVIEW_SECRET;
	});

	it("uses the collection's urlPattern when one is configured", async () => {
		const registry = new SchemaRegistry(db);
		await registry.createCollection({
			slug: "landing_pages",
			label: "Landing Pages",
			urlPattern: "/lp/{slug}",
		});
		await registry.createField("landing_pages", {
			slug: "title",
			label: "Title",
			type: "string",
		});

		const created = await emdash.handleContentCreate("landing_pages", {
			data: { title: "Campaign" },
			slug: "summer-campaign",
		});
		expect(created.success).toBe(true);
		const id = created.data!.item.id;

		const request = new Request(
			`http://localhost/_emdash/api/content/landing_pages/${id}/preview-url`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			},
		);
		const response = await postPreviewUrl(apiContext(request, emdash, "landing_pages", id));
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: { url: string; expiresAt: number } };
		const parsed = new URL(body.data.url, "http://placeholder");
		expect(parsed.pathname).toBe("/lp/summer-campaign");
		expect(parsed.searchParams.has("_preview")).toBe(true);
	});

	it("falls back to /{collection}/{id} when the collection has no urlPattern", async () => {
		const registry = new SchemaRegistry(db);
		await registry.createCollection({
			slug: "plain",
			label: "Plain",
		});
		await registry.createField("plain", {
			slug: "title",
			label: "Title",
			type: "string",
		});

		const created = await emdash.handleContentCreate("plain", {
			data: { title: "Plain entry" },
			slug: "plain-entry",
		});
		expect(created.success).toBe(true);
		const id = created.data!.item.id;

		const request = new Request(`http://localhost/_emdash/api/content/plain/${id}/preview-url`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		const response = await postPreviewUrl(apiContext(request, emdash, "plain", id));
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: { url: string; expiresAt: number } };
		const parsed = new URL(body.data.url, "http://placeholder");
		expect(parsed.pathname).toBe(`/plain/${id}`);
		expect(parsed.searchParams.has("_preview")).toBe(true);
	});
});
