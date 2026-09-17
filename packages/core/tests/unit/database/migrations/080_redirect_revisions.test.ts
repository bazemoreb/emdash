import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { up } from "../../../../src/database/migrations/080_redirect_revisions.js";

describe("080_redirect_revisions migration", () => {
	let db: Kysely<unknown> | undefined;

	afterEach(async () => {
		await db?.destroy();
	});

	it("backfills existing redirects and can restart after the column was added", async () => {
		const sqlite = new BetterSqlite3(":memory:");
		sqlite.exec(
			"CREATE TABLE _emdash_redirects (id TEXT PRIMARY KEY, source TEXT NOT NULL);" +
				"INSERT INTO _emdash_redirects (id, source) VALUES ('redirect-1', '/old')",
		);
		db = new Kysely<unknown>({ dialect: new SqliteDialect({ database: sqlite }) });

		await up(db);
		await up(db);

		const result = await sql<{ config_revision: string }>`
			SELECT config_revision FROM _emdash_redirects WHERE id = 'redirect-1'
		`.execute(db);
		expect(result.rows).toEqual([{ config_revision: "0" }]);
	});
});
