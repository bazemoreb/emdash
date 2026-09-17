import { type Kysely, sql } from "kysely";

import { columnExists } from "../dialect-helpers.js";

const DUPLICATE_COLUMN_REGEX =
	/(?:duplicate column|column .* already exists|already exists.*column)/i;

async function addColumnIfMissing(
	db: Kysely<unknown>,
	column: "config_revision" | "source_guard",
): Promise<void> {
	if (await columnExists(db, "_emdash_redirects", column)) return;
	try {
		await db.schema
			.alterTable("_emdash_redirects")
			.addColumn(column, column === "config_revision" ? "text" : "integer", (builder) =>
				builder.notNull().defaultTo(column === "config_revision" ? "0" : 0),
			)
			.execute();
	} catch (error) {
		if (
			error instanceof Error &&
			DUPLICATE_COLUMN_REGEX.test(error.message) &&
			(await columnExists(db, "_emdash_redirects", column))
		) {
			return;
		}
		throw error;
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await addColumnIfMissing(db, "config_revision");
	await addColumnIfMissing(db, "source_guard");

	// Preserve any historical duplicate rows, but nominate one existing row
	// per source for the uniqueness constraint. New rows and source-changing
	// updates set this flag, so they are database-enforced without deleting old data.
	await sql`
		UPDATE _emdash_redirects
		SET source_guard = 1
		WHERE id IN (
			SELECT MIN(id) FROM _emdash_redirects GROUP BY source
		)
		AND source_guard = 0
	`.execute(db);
	await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_redirects_managed_source
		ON _emdash_redirects (source)
		WHERE source_guard = 1
	`.execute(db);

	await db.schema
		.createTable("_emdash_redirect_write_lock")
		.ifNotExists()
		.addColumn("id", "integer", (column) => column.primaryKey())
		.addColumn("token", "text", (column) => column.notNull())
		.addColumn("expires_at", "integer", (column) => column.notNull())
		.execute();
	await sql`
		INSERT INTO _emdash_redirect_write_lock (id, token, expires_at)
		VALUES (1, '', 0)
		ON CONFLICT (id) DO NOTHING
	`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
