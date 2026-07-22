import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ShortcutRow {
  keys: string;
  description: string;
}

interface ListKeyboardHintProps {
  /** What Enter does in this dialog (the primary per-item action). */
  enterLabel: string;
  /** Optional label describing what Space toggles. */
  spaceLabel?: string;
}

/**
 * Unobtrusive "?" popover listing the list-navigation shortcuts, per the UX
 * doc rule that every desktop shortcut is discoverable in Help. Reused by the
 * Project Manager and Add Resources dialogs.
 */
export function ListKeyboardHint({
  enterLabel,
  spaceLabel = "Mark / unmark focused item",
}: ListKeyboardHintProps) {
  const rows: ShortcutRow[] = [
    { keys: "↑ / ↓", description: "Move focus" },
    { keys: "Home / End", description: "First / last item" },
    { keys: "Space", description: spaceLabel },
    { keys: "Enter", description: enterLabel },
    { keys: "Shift + ↑/↓", description: "Extend selection" },
    { keys: "Ctrl/⌘ + A", description: "Select all" },
    { keys: "Ctrl/⌘ + Shift + A", description: "Deselect all" },
    { keys: "Esc", description: "Close dialog" },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <h4 className="mb-2 text-sm font-semibold">Keyboard shortcuts</h4>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.keys}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="text-muted-foreground">{row.description}</span>
              <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                {row.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
