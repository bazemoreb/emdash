import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

let isolateId: string | undefined;
let recordSequence = 0;

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
		"comment:afterModerate": async (event, ctx) => {
			await record(ctx, "events", "comment-moderated", {
				commentId: event.comment.id,
				status: event.newStatus,
				origin: event.origin,
			});
			if (event.comment.moderationMetadata?.slowModeration === true) {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			if (
				event.origin?.source === "plugin" &&
				event.comment.moderationMetadata?.attemptRecursiveModeration === true
			) {
				try {
					await ctx.comments!.setStatus!(event.comment.id, "spam", {
						expectedStatus: "approved",
					});
				} catch (error) {
					await record(ctx, "events", "comment-recursion-blocked", {
						code:
							typeof error === "object" && error !== null && "code" in error ? error.code : null,
					});
				}
			}
		},
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
		"comments-read": {
			handler: async (route, ctx) => {
				if (
					typeof route.input !== "object" ||
					route.input === null ||
					!("id" in route.input) ||
					typeof route.input.id !== "string"
				) {
					throw new Error("Expected a comment id");
				}
				return {
					comment: await ctx.comments!.get(route.input.id),
					page: await ctx.comments!.list({ limit: 1 }),
					count: await ctx.comments!.count(),
				};
			},
		},
		"comments-moderate": {
			handler: async (route, ctx) => {
				if (typeof route.input !== "object" || route.input === null) {
					throw new Error("Expected moderation input");
				}
				const id = "id" in route.input && typeof route.input.id === "string" ? route.input.id : "";
				const status =
					"status" in route.input &&
					(route.input.status === "approved" ||
						route.input.status === "pending" ||
						route.input.status === "spam")
						? route.input.status
						: "pending";
				const expectedStatus =
					"expectedStatus" in route.input &&
					(route.input.expectedStatus === "approved" ||
						route.input.expectedStatus === "pending" ||
						route.input.expectedStatus === "spam")
						? route.input.expectedStatus
						: "pending";
				try {
					return await ctx.comments!.setStatus!(id, status, { expectedStatus });
				} catch (error) {
					return {
						error: {
							code:
								typeof error === "object" && error !== null && "code" in error ? error.code : null,
							currentStatus:
								typeof error === "object" && error !== null && "currentStatus" in error
									? error.currentStatus
									: null,
						},
					};
				}
			},
		},
		"comments-invalid-status": {
			handler: async (route, ctx) => {
				if (
					typeof route.input !== "object" ||
					route.input === null ||
					!("id" in route.input) ||
					typeof route.input.id !== "string"
				) {
					throw new Error("Expected a comment id");
				}
				try {
					// @ts-expect-error -- proves the runtime rejects untrusted values that bypass types
					await ctx.comments!.setStatus!(route.input.id, "trash", {
						expectedStatus: "pending",
					});
					return { rejected: false };
				} catch (error) {
					return {
						rejected: true,
						message: error instanceof Error ? error.message : String(error),
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
