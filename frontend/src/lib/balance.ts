/**
 * Pure balance/coverage counting: how many examples per metadata value and per class, so
 * imbalance (e.g. "red-sail 900 · blue-sail 12") is visible. No React/DOM.
 */
import { Instance, Scene, MetaField, Class } from "@/types/annotation";

export type FieldBalance = {
  key: string;
  scope: string;
  counts: Record<string, number>; // value -> count
  unset: number;
  total: number;
};

export type ClassBalance = { classId: string; name: string; count: number };

/** Count metadata values for scene- and instance-scoped fields (video-scope is a single value). */
export function countByField(instances: Instance[], scenes: Scene[], schema: MetaField[]): FieldBalance[] {
  return schema
    .filter((f) => f.scope === "instance" || f.scope === "scene")
    .map((f) => {
      const counts: Record<string, number> = {};
      let unset = 0;
      let total = 0;
      const bump = (v?: string) => {
        total++;
        const t = (v || "").trim();
        if (t) counts[t] = (counts[t] || 0) + 1;
        else unset++;
      };
      if (f.scope === "instance") instances.forEach((i) => bump(i.metadata?.[f.key]));
      else scenes.forEach((s) => bump(s.metadata?.[f.key]));
      return { key: f.key, scope: f.scope, counts, unset, total };
    });
}

/** Instance count per class. */
export function countByClass(classes: Class[], instances: Instance[]): ClassBalance[] {
  return classes.map((c) => ({
    classId: c.id,
    name: c.name,
    count: instances.filter((i) => i.classId === c.id).length,
  }));
}
