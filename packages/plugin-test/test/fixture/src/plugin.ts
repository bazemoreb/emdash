import type {
	PluginContext,
	RedirectCreateInput,
	RedirectListOptions,
	RedirectStatus,
	RedirectUpdateInput,
	SandboxedPlugin,
} from "emdash/plugin";

let isolateId: string | undefined;
let recordSequence = 0;

type RedirectCreateProbeInput = RedirectCreateInput & { auto?: unknown };
type RedirectUpdateProbeInput = RedirectUpdateInput & { _rev: string; auto?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`${key} must be a string`);
	return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
	const value = input[key];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
	return value;
}

function optionalNullableString(
	input: Record<string, unknown>,
	key: string,
): string | null | undefined {
	const value = input[key];
	if (value === undefined || value === null) return value;
	if (typeof value !== "string") throw new Error(`${key} must be a string or null`);
	return value;
}

function optionalStatus(input: Record<string, unknown>): RedirectStatus | undefined {
	switch (input.type) {
		case undefined:
		case 301:
		case 302:
		case 307:
		case 308:
		case 410:
		case 451:
			return input.type;
		default:
			throw new Error("type must be a supported redirect status");
	}
}

function redirectListOptions(value: unknown): RedirectListOptions {
	if (!isRecord(value)) throw new Error("options must be an object");
	const limit = value.limit;
	if (limit !== undefined && typeof limit !== "number") throw new Error("limit must be a number");
	return {
		limit,
		cursor: optionalString(value, "cursor"),
		search: optionalString(value, "search"),
		group: optionalString(value, "group"),
		enabled: optionalBoolean(value, "enabled"),
		auto: optionalBoolean(value, "auto"),
	};
}

function redirectCreateInput(value: unknown): RedirectCreateProbeInput {
	if (!isRecord(value) || typeof value.source !== "string") {
		throw new Error("redirect.source must be a string");
	}
	return {
		source: value.source,
		destination: optionalString(value, "destination"),
		type: optionalStatus(value),
		enabled: optionalBoolean(value, "enabled"),
		groupName: optionalNullableString(value, "groupName"),
		...(Object.hasOwn(value, "auto") ? { auto: value.auto } : {}),
	};
}

function redirectUpdateInput(value: unknown): RedirectUpdateProbeInput {
	if (!isRecord(value) || typeof value._rev !== "string") {
		throw new Error("redirect._rev must be a string");
	}
	return {
		_rev: value._rev,
		source: optionalString(value, "source"),
		destination: optionalString(value, "destination"),
		type: optionalStatus(value),
		enabled: optionalBoolean(value, "enabled"),
		groupName: optionalNullableString(value, "groupName"),
		...(Object.hasOwn(value, "auto") ? { auto: value.auto } : {}),
	};
}

async function record(
	ctx: PluginContext,
	collection: string,
	type: string,
	data: Record<string, unknown> = {},
) {
	await ctx.storage[collection]!.put(String(++recordSequence).padStart(8, "0"), { type, ...data });
}

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:install": async (_event, ctx) => record(ctx, "lifecycle", "install"),
		"plugin:activate": async (_event, ctx) => record(ctx, "lifecycle", "activate"),
		"plugin:deactivate": async (_event, ctx) => record(ctx, "lifecycle", "deactivate"),
		"plugin:uninstall": async (event, ctx) =>
			record(ctx, "lifecycle", "uninstall", { deleteData: event.deleteData }),
		"content:beforeSave": async (event) => ({
			...event.content,
			title: `${String(event.content.title)} [sandbox]`,
		}),
		"content:afterSave": {
			handler: async (event, ctx) => {
				await ctx.storage.events!.put(String(event.content.id), {
					type: "saved",
					collection: event.collection,
				});
			},
		},
		"media:beforeUpload": async (event) => ({
			...event.file,
			name: `checked-${event.file.name}`,
			size: event.file.size + 1,
		}),
		"media:afterUpload": async (event, ctx) =>
			record(ctx, "events", "media-uploaded", {
				mediaId: event.media.id,
				size: event.media.size,
			}),
		"comment:afterCreate": async (event, ctx) =>
			record(ctx, "events", "comment-created", { commentId: event.comment.id }),
		"comment:afterModerate": async (event, ctx) =>
			record(ctx, "events", "comment-moderated", {
				commentId: event.comment.id,
				status: event.newStatus,
			}),
		cron: async (event, ctx) =>
			record(ctx, "events", "cron", { name: event.name, scheduledAt: event.scheduledAt }),
	},
	routes: {
		"isolate-id": {
			public: true,
			cacheControl: "public, max-age=60",
			handler: async () => ({ isolateId: (isolateId ??= crypto.randomUUID()) }),
		},
		"site-info": {
			public: true,
			handler: async (_route, ctx) => ctx.site,
		},
		hello: {
			public: true,
			cacheControl: "public, max-age=60",
			handler: async (_route, ctx) => {
				await ctx.kv.set("last-route", "hello");
				return { pluginId: ctx.plugin.id };
			},
		},
		"content-count": {
			permission: "content:read",
			handler: async (_route, ctx) => {
				const result = await ctx.content!.list("posts");
				return { count: result.items.length };
			},
		},
		redirects: {
			permission: "redirects:manage",
			handler: async (route, ctx) => {
				if (!isRecord(route.input)) {
					throw new Error("Expected redirect operation input");
				}
				const input = route.input;
				const operation = input.operation;
				try {
					if (operation === "list") {
						return await ctx.redirects!.list(redirectListOptions(input.options ?? {}));
					}
					if (operation === "get") return await ctx.redirects!.get(String(input.id));
					if (operation === "create") {
						return await ctx.redirects!.create!(redirectCreateInput(input.redirect));
					}
					if (operation === "update") {
						return await ctx.redirects!.update!(
							String(input.id),
							redirectUpdateInput(input.redirect),
						);
					}
					if (operation === "delete") {
						return {
							deleted: await ctx.redirects!.delete!(String(input.id), {
								_rev: String(input._rev),
							}),
						};
					}
					throw new Error("Unknown redirect operation");
				} catch (error) {
					return {
						error: {
							code:
								typeof error === "object" && error !== null && "code" in error
									? String(error.code)
									: "UNKNOWN",
							message: error instanceof Error ? error.message : "Redirect operation failed",
						},
					};
				}
			},
		},
		"settings-value": {
			handler: async (_route, ctx) => ({
				enabled: await ctx.kv.get("settings:enabled"),
			}),
		},
		"settings-update": {
			handler: async (route, ctx) => {
				const enabled =
					typeof route.input === "object" &&
					route.input !== null &&
					"enabled" in route.input &&
					route.input.enabled === true;
				await ctx.kv.set("settings:enabled", enabled);
				return { enabled };
			},
		},
		"private-user": {
			permission: "content:edit_any",
			handler: async (route) => ({ userId: route.user?.id ?? null }),
		},
		"schedule-once": {
			handler: async (route, ctx) => {
				if (
					typeof route.input !== "object" ||
					route.input === null ||
					!("at" in route.input) ||
					typeof route.input.at !== "string"
				) {
					throw new Error("Expected an ISO timestamp");
				}
				const at = route.input.at;
				const name =
					"name" in route.input && typeof route.input.name === "string"
						? route.input.name
						: "runtime-test";
				await ctx.cron!.schedule(name, { schedule: at });
				return { scheduled: true };
			},
		},
		"send-email": {
			handler: async (_route, ctx) => {
				await ctx.email!.send({
					to: "author@example.com",
					subject: "Runtime host",
					text: "Captured by the test host",
				});
				return { sent: true };
			},
		},
	},
};

export default plugin;
