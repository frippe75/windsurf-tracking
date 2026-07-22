/**
 * Pure helpers for a metadata Generate run: keep stored metadata in sync with the current
 * schema (prune keys no longer in the schema — e.g. leftover mock fields), and decide
 * whether a scene/instance already has every field so a re-run can skip it (incremental).
 */

/** Drop any key not in the current schema — cleans stale/mock metadata on write. */
export function pruneMeta(
  meta: Record<string, string> | undefined,
  allowedKeys: Set<string>,
): Record<string, string> {
  if (!meta) return {};
  return Object.fromEntries(Object.entries(meta).filter(([k]) => allowedKeys.has(k)));
}

/** True if every key has a non-empty value present — used to skip already-filled work. */
export function hasAllKeys(meta: Record<string, string> | undefined, keys: string[]): boolean {
  if (keys.length === 0) return true;
  return keys.every((k) => meta?.[k] != null && meta[k] !== "");
}
