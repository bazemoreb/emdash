import type { Kysely } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { RedirectRepository } from "../../../src/database/repositories/redirect.js";
import type { Database } from "../../../src/database/types.js";
import { createRedirectAccess } from "../../../src/plugins/context.js";
import {
	type DialectTestContext,
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
} from "../../utils/test-db.js";

describeEachDialect("plugin redirect optimistic concurrency", (dialect) => {
	let ctx: DialectTestContext;
	let db: Kysely<Database>;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- dialect test contexts use the same migrated Database schema
		db = ctx.db as unknown as Kysely<Database>;
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	it("guards configuration writes without conflicting on hit tracking", async () => {
		const access = createRedirectAccess(db, true);
		const created = await access.create({ source: "/old", destination: "/current" });
		await new RedirectRepository(db).recordHit(created.redirect.id);

		const updated = await access.update(created.redirect.id, {
			destination: "/latest",
			_rev: created._rev,
		});
		expect(updated.redirect).toMatchObject({ destination: "/latest", hits: 1 });
		await expect(
			access.update(created.redirect.id, {
				destination: "/lost",
				_rev: created._rev,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});
});
