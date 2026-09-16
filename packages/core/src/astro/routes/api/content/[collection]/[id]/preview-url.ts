/**
 * Preview URL endpoint - generates a signed preview URL for content
 *
 * POST /_emdash/api/content/{collection}/{id}/preview-url
 *
 * Request body:
 * {
 *   expiresIn?: string | number;  // Default: "1h"
 *   pathPattern?: string;         // Default: "/{collection}/{id}" (or EMDASH_PREVIEW_PATH_PATTERN)
 * }
 *
 * Response:
 * {
 *   url: string;      // The preview URL with token
 *   expiresAt: number; // Unix timestamp when token expires
 * }
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError, unwrapResult } from "#api/error.js";
import { parseOptionalBody, isParseError } from "#api/parse.js";
import { contentPreviewUrlBody } from "#api/schemas.js";
import { resolveSecretsCached } from "#config/secrets.js";
import { generatePreviewToken } from "#preview/tokens.js";
import { buildPreviewUrl, getPreviewUrl } from "#preview/urls.js";

import { getI18nConfig } from "../../../../../../i18n/config.js";
import { interpolateUrlPattern, localizePath } from "../../../../../../i18n/resolve.js";
import { SchemaRegistry } from "../../../../../../schema/registry.js";

export const prerender = false;

const DURATION_PATTERN = /^(\d+)([smhdw])$/;

export const POST: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:read_drafts");
	if (denied) return denied;
	const collection = params.collection!;
	const id = params.id!;

	// Resolve the preview secret. Env override wins; otherwise a stable
	// site-specific value is read from (or generated into) the options table.
	// The resolver always returns a usable secret, so this path can no
	// longer be silently disabled by a missing env var.
	const { previewSecret } = await resolveSecretsCached(emdash.db);

	// Verify the content exists and capture the fields needed to build a
	// canonical preview path: slug/id, publish date (for date tokens), and
	// locale (for the i18n prefix).
	let item: {
		slug: string | null;
		id: string;
		publishedAt: string | null;
		locale: string | null;
	} | null = null;
	if (emdash?.handleContentGet) {
		const result = await emdash.handleContentGet(collection, id);
		if (!result.success) return unwrapResult(result);
		const resultItem = result.data?.item;
		if (resultItem) {
			item = {
				slug: resultItem.slug ?? null,
				id: resultItem.id,
				publishedAt: resultItem.publishedAt ?? null,
				locale: resultItem.locale ?? null,
			};
		}
	}

	// Parse request body
	const body = await parseOptionalBody(request, contentPreviewUrlBody, {});
	if (isParseError(body)) return body;

	const expiresIn = body.expiresIn || "1h";

	// Calculate expiry timestamp
	const expiresInSeconds = typeof expiresIn === "number" ? expiresIn : parseExpiresIn(expiresIn);
	const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

	try {
		let url: string;

		// Prefer the collection's stored urlPattern so the admin preview link
		// matches the canonical URLs the head built-ins emit. The env/default
		// pattern is the legacy fallback for collections without a pattern.
		const registry = new SchemaRegistry(emdash.db);
		const collectionMeta = await registry.getCollection(collection);
		const collectionPattern = collectionMeta?.urlPattern ?? null;

		if (collectionPattern && item) {
			const interpolatedPath = interpolateUrlPattern({
				pattern: collectionPattern,
				collection,
				slug: item.slug || item.id,
				id: item.id,
				date: item.publishedAt,
			});
			const localizedPath = await localizePath(
				interpolatedPath,
				item.locale || getI18nConfig()?.defaultLocale || "en",
			);

			const token = await generatePreviewToken({
				contentId: `${collection}:${id}`,
				expiresIn,
				secret: previewSecret,
			});

			url = buildPreviewUrl({ path: localizedPath ?? interpolatedPath, token });
		} else {
			// Allow a project-wide default `pathPattern` so the admin's "View on site"
			// link can match the site's actual route shape without each call having
			// to override the default `/{collection}/{id}`.
			const defaultPathPattern =
				import.meta.env.EMDASH_PREVIEW_PATH_PATTERN || "/{collection}/{id}";
			const pathPattern = body.pathPattern || defaultPathPattern;

			// Resolve the locale segment substituted for `{locale}`: empty when the
			// entry is in the default locale and `prefixDefaultLocale` is `false`,
			// the entry's own locale otherwise.
			const i18n = getI18nConfig();
			let localeSegment = "";
			const entryLocale = item?.locale ?? null;
			if (entryLocale && i18n) {
				const isDefault = entryLocale === i18n.defaultLocale;
				localeSegment = isDefault && !i18n.prefixDefaultLocale ? "" : entryLocale;
			} else if (entryLocale) {
				localeSegment = entryLocale;
			}

			url = await getPreviewUrl({
				collection,
				id,
				secret: previewSecret,
				expiresIn,
				pathPattern,
				locale: localeSegment,
			});
		}

		return apiSuccess({ url, expiresAt });
	} catch (error) {
		return handleError(error, "Failed to generate preview URL", "TOKEN_ERROR");
	}
};

/**
 * Parse duration string to seconds
 */
function parseExpiresIn(duration: string): number {
	const match = duration.match(DURATION_PATTERN);
	if (!match) {
		return 3600; // Default 1 hour
	}

	const value = parseInt(match[1], 10);
	const unit = match[2];

	switch (unit) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 60 * 60;
		case "d":
			return value * 60 * 60 * 24;
		case "w":
			return value * 60 * 60 * 24 * 7;
		default:
			return 3600;
	}
}
