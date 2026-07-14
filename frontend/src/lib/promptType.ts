export type PromptType = "positive" | "negative";

/**
 * Resolve which SAM2 prompt a canvas tap/click should place.
 *
 * Desktop keyboard modifiers take priority (unchanged behaviour):
 *   - Alt (or Alt-Gr, which registers as ctrl+alt) → negative
 *   - Ctrl only → positive
 * With no modifier (e.g. a phone with no keyboard), fall back to `tapMode`:
 *   - "positive" / "negative" → a plain tap places that prompt
 *   - null → nothing (caller should prompt the user to pick a mode)
 */
export function resolvePromptType(
  ctrlKey: boolean,
  altKey: boolean,
  tapMode: PromptType | null,
): PromptType | null {
  if (altKey) return "negative";
  if (ctrlKey) return "positive";
  return tapMode;
}
