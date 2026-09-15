import type { RouteContext } from "emdash";
import { describe, expect, it, vi } from "vitest";

import { submitHandler } from "../src/handlers/submit.js";
import type { SubmitInput } from "../src/schemas.js";
import type { FormDefinition } from "../src/types.js";

const baseForm: FormDefinition = {
	name: "Contact",
	slug: "contact",
	pages: [
		{
			fields: [
				{
					id: "name",
					type: "text",
					label: "Name",
					name: "name",
					required: false,
					width: "full",
				},
			],
		},
	],
	settings: {
		confirmationMessage: "Thank you.",
		submitLabel: "Send",
		notifyEmails: [],
		digestEnabled: false,
		digestHour: 9,
		retentionDays: 0,
		spamProtection: "none",
	},
	status: "active",
	submissionCount: 0,
	lastSubmissionAt: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};

function makeStorage() {
	const forms = new Map<string, FormDefinition>();
	const submissions = new Map<string, unknown>();
	return {
		forms: {
			get: vi.fn(async (id: string) => forms.get(id) ?? null),
			put: vi.fn(async (id: string, data: FormDefinition) => {
				forms.set(id, data);
			}),
			query: vi.fn(async ({ where }: { where?: { slug?: string } }) => {
				const items = [] as Array<{ id: string; data: FormDefinition }>;
				for (const [id, data] of forms) {
					if (!where || !where.slug || data.slug === where.slug) {
						items.push({ id, data });
					}
				}
				return { items, total: items.length };
			}),
			count: vi.fn(async () => submissions.size),
		},
		submissions: {
			put: vi.fn(async (id: string, data: unknown) => {
				submissions.set(id, data);
			}),
			count: vi.fn(async () => submissions.size),
		},
	};
}

function makeContext(
	form: FormDefinition,
	fetch: (url: string, init?: RequestInit) => Promise<Response>,
): RouteContext<SubmitInput> {
	const storage = makeStorage();
	storage.forms.put("form-1", form);

	return {
		plugin: { id: "emdash-forms", version: "0.2.6" },
		storage: storage as unknown as RouteContext["storage"],
		kv: {
			get: vi.fn(async () => null),
			getVersioned: vi.fn(async () => null),
			compareAndSet: vi.fn(async () => ({ success: true })),
			compareAndDelete: vi.fn(async () => ({ success: true })),
			set: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			list: vi.fn(async () => []),
		},
		log: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
		site: { name: "Test", url: "https://example.com", locale: "en" },
		url: (path: string) => `https://example.com${path}`,
		request: new Request("https://example.com/", { method: "POST" }),
		requestMeta: { ip: null, userAgent: null, referer: null, geo: null },
		input: { formId: "form-1", data: { name: "Ada" } },
		http: { fetch },
	} as RouteContext<SubmitInput>;
}

async function drainDeferredTasks() {
	// `after()` in core defers work to the microtask/task queue and falls back
	// to fire-and-forget when no host waitUntil is registered. Give deferred
	// callbacks (including the webhook block) a chance to run.
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("submitHandler webhook", () => {
	it("logs an error when the webhook returns a non-2xx status", async () => {
		const fetch = vi.fn(async () => new Response("Internal Server Error", { status: 500 }));
		const form: FormDefinition = {
			...baseForm,
			settings: {
				...baseForm.settings,
				webhookUrl: "https://example.com/webhook",
			},
		};
		const ctx = makeContext(form, fetch);

		await expect(submitHandler(ctx)).resolves.toEqual({
			success: true,
			message: "Thank you.",
			redirect: undefined,
		});

		await drainDeferredTasks();

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			"https://example.com/webhook",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
			}),
		);
		expect(ctx.log.error).toHaveBeenCalledWith(
			"Webhook failed",
			expect.objectContaining({ status: 500, url: "https://example.com/webhook" }),
		);
	});

	it("logs an error when the webhook fetch rejects", async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError("fetch failed");
		});
		const form: FormDefinition = {
			...baseForm,
			settings: {
				...baseForm.settings,
				webhookUrl: "https://example.com/webhook",
			},
		};
		const ctx = makeContext(form, fetch);

		await expect(submitHandler(ctx)).resolves.toEqual({
			success: true,
			message: "Thank you.",
			redirect: undefined,
		});

		await drainDeferredTasks();

		expect(ctx.log.error).toHaveBeenCalledWith(
			"Webhook failed",
			expect.objectContaining({
				error: "TypeError: fetch failed",
				url: "https://example.com/webhook",
			}),
		);
	});

	it("logs the final URL when a redirect changes the response URL", async () => {
		const fetch = vi.fn(async () =>
			Response.json({ ok: true }, { status: 200, headers: { "X-Final-Url": "ignored" } }),
		);
		const form: FormDefinition = {
			...baseForm,
			settings: {
				...baseForm.settings,
				webhookUrl: "https://example.com/webhook",
			},
		};
		const ctx = makeContext(form, fetch);
		// Override the response URL so it reports a redirect target.
		const res = await fetch("");
		Object.defineProperty(res, "url", { value: "https://example.com/login" });
		fetch.mockResolvedValueOnce(res);

		await expect(submitHandler(ctx)).resolves.toEqual({
			success: true,
			message: "Thank you.",
			redirect: undefined,
		});

		await drainDeferredTasks();

		expect(ctx.log.warn).toHaveBeenCalledWith(
			"Webhook was redirected",
			expect.objectContaining({
				url: "https://example.com/webhook",
				finalUrl: "https://example.com/login",
			}),
		);
	});
});
