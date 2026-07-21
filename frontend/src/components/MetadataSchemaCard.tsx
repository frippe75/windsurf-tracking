import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Trash2, Plus, Loader2 } from "lucide-react";
import { MetaField } from "@/types/annotation";
import { extractMetadata } from "@/lib/pipelineApi";
import { schemaDraftRequest, normalizeField } from "@/lib/metaSchema";

/**
 * The per-project metadata schema editor. "Auto-draft" asks Claude (text-only) to propose a
 * categorical taxonomy from the project name/description + classes; fields are then editable and
 * drive extraction + the balance view. Enum value-sets are what make balance countable.
 */
type Props = {
  schema: MetaField[];
  onUpdate: (fields: MetaField[]) => void;
  projectName: string;
  description?: string;
  classNames: string[];
};

export function MetadataSchemaCard({ schema, onUpdate, projectName, description, classNames }: Props) {
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState("");
  const [newKey, setNewKey] = useState("");

  const updateField = (i: number, patch: Partial<MetaField>) =>
    onUpdate(schema.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const removeField = (i: number) => onUpdate(schema.filter((_, idx) => idx !== i));
  const addField = () => {
    const k = newKey.trim();
    if (!k) return;
    onUpdate([...schema, { key: k, scope: "scene", type: "enum", values: [] }]);
    setNewKey("");
  };

  async function draft() {
    setDrafting(true);
    setErr("");
    try {
      const { prompt, schema: metaSchema } = schemaDraftRequest(projectName, description || "", classNames);
      const res = await extractMetadata({ prompt, schema: metaSchema });
      const fields = (res?.fields || []).map(normalizeField).filter(Boolean) as MetaField[];
      if (fields.length) onUpdate(fields);
      else setErr("Claude returned no fields.");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <Card className="p-3 bg-card border-border space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Metadata schema</h4>
        <Button size="sm" variant="outline" onClick={draft} disabled={drafting} className="h-7">
          {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
          {drafting ? "Drafting…" : "Auto-draft"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">The dataset's metadata taxonomy — enums make class balance countable.</p>

      {schema.length === 0 && (
        <div className="text-[11px] text-muted-foreground">No fields yet. Auto-draft from the project + classes, or add one below.</div>
      )}

      <div className="space-y-1">
        {schema.map((f, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} className="h-6 flex-1 px-1 text-[11px]" />
            <select
              value={f.scope}
              onChange={(e) => updateField(i, { scope: e.target.value as MetaField["scope"] })}
              className="h-6 rounded border border-border bg-background px-1 text-[10px]"
            >
              <option value="scene">scene</option>
              <option value="instance">instance</option>
              <option value="video">video</option>
            </select>
            <select
              value={f.type}
              onChange={(e) => updateField(i, { type: e.target.value as MetaField["type"] })}
              className="h-6 rounded border border-border bg-background px-1 text-[10px]"
            >
              <option value="enum">enum</option>
              <option value="text">text</option>
            </select>
            {f.type === "enum" && (
              <Input
                value={(f.values || []).join(", ")}
                placeholder="a, b, c"
                onChange={(e) => updateField(i, { values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                className="h-6 w-28 px-1 text-[10px]"
                title="Comma-separated values"
              />
            )}
            <button onClick={() => removeField(i)} className="text-destructive hover:opacity-80" title="Remove">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="new field key"
          onKeyDown={(e) => e.key === "Enter" && addField()}
          className="h-6 flex-1 px-1 text-[11px]"
        />
        <Button size="sm" variant="ghost" onClick={addField} className="h-6 px-2">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {err && <div className="text-[11px] text-destructive break-words">{err}</div>}
    </Card>
  );
}
