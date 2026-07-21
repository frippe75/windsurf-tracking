import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Instance, Scene, Class, MetaField } from "@/types/annotation";
import { countByField, countByClass } from "@/lib/balance";

/** Coverage/balance view: instances per class + counts per metadata value, so imbalance is visible. */
type Props = { classes: Class[]; instances: Instance[]; scenes: Scene[]; schema: MetaField[] };

function Bar({ label, count, max, color }: { label: string; count: number; max: number; color?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="truncate">{label}</span>
        <span className="text-foreground">{count}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-muted">
        <div className="h-full rounded" style={{ width: `${(count / max) * 100}%`, backgroundColor: color || "hsl(217, 91%, 60%)" }} />
      </div>
    </div>
  );
}

export function BalancePanel({ classes, instances, scenes, schema }: Props) {
  const classCounts = countByClass(classes, instances);
  const fieldBalances = countByField(instances, scenes, schema);
  const maxClass = Math.max(1, ...classCounts.map((c) => c.count));

  return (
    <Card className="p-4 bg-card border-border space-y-3">
      <h3 className="text-sm font-semibold">Balance</h3>

      <div className="space-y-1">
        <div className="text-[11px] text-muted-foreground">Instances per class</div>
        {classCounts.map((c) => (
          <Bar key={c.classId} label={c.name} count={c.count} max={maxClass} color={classes.find((k) => k.id === c.classId)?.color} />
        ))}
        {classCounts.length === 0 && <div className="text-[11px] text-muted-foreground">No classes yet.</div>}
      </div>

      {fieldBalances.map((fb) => {
        const entries = Object.entries(fb.counts).sort((a, b) => b[1] - a[1]);
        const max = Math.max(1, ...entries.map((e) => e[1]), fb.unset);
        return (
          <div key={fb.key} className="space-y-1 border-t border-border pt-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {fb.key} <span className="opacity-60">({fb.scope})</span>
              </span>
              <Badge variant="secondary" className="text-[10px]">{fb.total}</Badge>
            </div>
            {entries.map(([v, n]) => (
              <Bar key={v} label={v} count={n} max={max} />
            ))}
            {fb.unset > 0 && <Bar label="(unset)" count={fb.unset} max={max} color="hsl(0, 0%, 55%)" />}
            {entries.length === 0 && fb.unset === 0 && <div className="text-[10px] text-muted-foreground">no data</div>}
          </div>
        );
      })}

      {schema.length === 0 && (
        <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          Define a metadata schema (Project Manager → Auto-draft) and run Generate Metadata to see coverage.
        </div>
      )}
    </Card>
  );
}
