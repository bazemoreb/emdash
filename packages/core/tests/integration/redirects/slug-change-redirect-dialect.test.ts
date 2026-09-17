import type { Kysely } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { handleContentUpdate } from "../../../src/api/handlers/content.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import type { Database } from "../../../src/database/types.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import {
	type DialectTestContext,
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
} from "../../utils/test-db.js";

describeEachDialect("published slug-change redirects", (dialect) => {
	let ctx: DialectTestContext;
	let db: Kysely<Database>;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- dialect test contexts use the same migrated Database schema
		db = ctx.db as unknown as Kysely<Database>;
		const schema = new SchemaRegistry(db);
		await schema.createCollection({
			slug: "posts",
			label: "Posts",
			urlPattern: "/blog/{slug}",
		});
		await schema.createField("posts", { slug: "title", label: "Title", type: "string" });
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	it("creates an automatic redirect inside the content update transaction", async () => {
		const entry = await new ContentRepository(db).create({
			type: "posts",
			slug: "old-title",
			status: "published",
			data: { title: "Old title" },
		});

		await expect(
			handleContentUpdate(db, "posts", entry.id, { slug: "new-title" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			db.selectFrom("_emdash_redirects").select(["source", "destination", "auto"]).execute(),
		).resolves.toEqual([
			expect.objectContaining({
				source: "/blog/old-title",
				destination: "/blog/new-title",
				auto: 1,
			}),
		]);
	});
});
