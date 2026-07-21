/**
 * Pure helpers for the per-project metadata schema: turn MetaFields into an Anthropic tool
 * `input_schema`, and build the meta-request that asks Claude to draft a schema from the dataset
 * purpose + classes. No React/DOM.
 */
import { MetaField } from "@/types/annotation";

/** Anthropic tool input_schema for one scope's fields (enum -> enum, text -> string). */
export function toJsonSchema(fields: MetaField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    const key = (f.key || "").trim();
    if (!key) continue;
    properties[key] =
      f.type === "enum" && f.values && f.values.length
        ? { type: "string", enum: f.values }
        : { type: "string" };
    required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** The prompt + schema that make Claude propose a categorical metadata taxonomy. */
export function schemaDraftRequest(name: string, description: string, classNames: string[]) {
  const prompt = [
    "Create a metadata schema for a machine-vision dataset so we can measure class balance/imbalance.",
    `Dataset name: "${name}".`,
    description ? `Purpose: ${description}.` : "",
    classNames.length ? `Object classes: ${classNames.join(", ")}.` : "",
    "Propose 4-8 CATEGORICAL fields (prefer enum value-sets over free text) covering scene conditions and",
    "object attributes — e.g. weather, wave conditions, sail color, sail brand. For each field give:",
    "key (snake_case), scope (scene | instance | video), type (enum | text), and values (for enum).",
  ]
    .filter(Boolean)
    .join(" ");

  const schema = {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            scope: { type: "string", enum: ["scene", "instance", "video"] },
            type: { type: "string", enum: ["enum", "text"] },
            values: { type: "array", items: { type: "string" } },
          },
          required: ["key", "scope", "type"],
        },
      },
    },
    required: ["fields"],
    additionalProperties: false,
  };
  return { prompt, schema };
}

/** Coerce a raw drafted field (from Claude) into a valid MetaField. */
export function normalizeField(raw: any): MetaField | null {
  const key = (raw?.key || "").trim();
  if (!key) return null;
  const scope = ["scene", "instance", "video"].includes(raw?.scope) ? raw.scope : "scene";
  const type = raw?.type === "text" ? "text" : "enum";
  const values = Array.isArray(raw?.values) ? raw.values.map(String).filter(Boolean) : undefined;
  return { key, scope, type, values: type === "enum" ? values : undefined };
}
