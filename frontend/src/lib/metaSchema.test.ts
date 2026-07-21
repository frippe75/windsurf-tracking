import { describe, it, expect } from "vitest";
import { toJsonSchema, schemaDraftRequest, normalizeField } from "./metaSchema";
import { MetaField } from "@/types/annotation";

describe("toJsonSchema", () => {
  it("maps enum -> enum, text -> string, and lists required", () => {
    const fields: MetaField[] = [
      { key: "sail_color", scope: "instance", type: "enum", values: ["red", "blue"] },
      { key: "notes", scope: "scene", type: "text" },
    ];
    const s = toJsonSchema(fields);
    expect(s.properties).toEqual({
      sail_color: { type: "string", enum: ["red", "blue"] },
      notes: { type: "string" },
    });
    expect(s.required).toEqual(["sail_color", "notes"]);
    expect(s.additionalProperties).toBe(false);
  });

  it("skips blank keys; enum without values falls back to string", () => {
    const s = toJsonSchema([
      { key: "  ", scope: "scene", type: "enum", values: ["x"] },
      { key: "weather", scope: "scene", type: "enum" },
    ]);
    expect(Object.keys(s.properties as object)).toEqual(["weather"]);
    expect((s.properties as any).weather).toEqual({ type: "string" });
  });
});

describe("schemaDraftRequest", () => {
  it("includes the name, purpose, and classes; schema has a fields array", () => {
    const { prompt, schema } = schemaDraftRequest("Sail set", "one sail brand", ["sail", "board"]);
    expect(prompt).toContain("Sail set");
    expect(prompt).toContain("one sail brand");
    expect(prompt).toContain("sail, board");
    expect((schema as any).properties.fields.type).toBe("array");
  });
});

describe("normalizeField", () => {
  it("coerces a raw drafted field", () => {
    expect(normalizeField({ key: "weather", scope: "scene", type: "enum", values: ["sunny", "cloudy"] }))
      .toEqual({ key: "weather", scope: "scene", type: "enum", values: ["sunny", "cloudy"] });
  });
  it("defaults bad scope->scene, non-text->enum, drops blank key", () => {
    expect(normalizeField({ key: "x", scope: "nope", type: "weird" })).toEqual({ key: "x", scope: "scene", type: "enum", values: undefined });
    expect(normalizeField({ key: "" })).toBeNull();
  });
});
