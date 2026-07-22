import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useListKeyboardNav } from "./useListKeyboardNav";

/** Build a minimal synthetic keyboard event for onKeyDown. */
function key(
  k: string,
  mods: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    target: Partial<HTMLElement>;
  }> = {},
): ReactKeyboardEvent {
  return {
    key: k,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    target: (mods.target ?? null) as EventTarget,
    preventDefault: vi.fn(),
  } as unknown as ReactKeyboardEvent;
}

const IDS = ["a", "b", "c", "d"];

describe("useListKeyboardNav", () => {
  it("starts with nothing focused and empty selection", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS }),
    );
    expect(result.current.focusedIndex).toBe(-1);
    expect(result.current.selectedCount).toBe(0);
  });

  it("ArrowDown/ArrowUp move roving focus and clamp at the ends", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS }),
    );
    act(() => result.current.onKeyDown(key("ArrowDown"))); // -1 -> 0
    expect(result.current.focusedIndex).toBe(0);
    act(() => result.current.onKeyDown(key("ArrowDown"))); // 0 -> 1
    expect(result.current.focusedIndex).toBe(1);
    act(() => result.current.onKeyDown(key("ArrowUp"))); // 1 -> 0
    expect(result.current.focusedIndex).toBe(0);
    act(() => result.current.onKeyDown(key("ArrowUp"))); // clamp at 0
    expect(result.current.focusedIndex).toBe(0);
  });

  it("Home and End jump to first and last", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS }),
    );
    act(() => result.current.onKeyDown(key("End")));
    expect(result.current.focusedIndex).toBe(3);
    act(() => result.current.onKeyDown(key("Home")));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("Space toggles selection of the focused item", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS }),
    );
    act(() => result.current.onKeyDown(key("ArrowDown"))); // focus 0
    act(() => result.current.onKeyDown(key(" ")));
    expect(result.current.isSelected("a")).toBe(true);
    act(() => result.current.onKeyDown(key(" ")));
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("Enter invokes onActivate for the focused item", () => {
    const onActivate = vi.fn();
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS, onActivate }),
    );
    act(() => result.current.onKeyDown(key("ArrowDown"))); // focus 0
    act(() => result.current.onKeyDown(key("ArrowDown"))); // focus 1
    act(() => result.current.onKeyDown(key("Enter")));
    expect(onActivate).toHaveBeenCalledWith("b");
  });

  it("Ctrl+A selects all selectable, Ctrl+Shift+A clears", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({
        itemIds: IDS,
        isSelectable: (id) => id !== "c", // c is not selectable
      }),
    );
    const evt = key("a", { ctrlKey: true });
    act(() => result.current.onKeyDown(evt));
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(result.current.selectedCount).toBe(3);
    expect(result.current.isSelected("c")).toBe(false);

    act(() => result.current.onKeyDown(key("A", { ctrlKey: true, shiftKey: true })));
    expect(result.current.selectedCount).toBe(0);
  });

  it("Shift+ArrowDown extends a range selection from the anchor", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS }),
    );
    act(() => result.current.onKeyDown(key("ArrowDown"))); // focus 0, anchor 0
    act(() => result.current.onKeyDown(key("ArrowDown"))); // focus 1, anchor 1
    act(() => result.current.onKeyDown(key("ArrowDown", { shiftKey: true }))); // 1->2, range 1..2
    expect(result.current.focusedIndex).toBe(2);
    expect(result.current.isSelected("b")).toBe(true);
    expect(result.current.isSelected("c")).toBe(true);
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("does not toggle non-selectable items on Space", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS, isSelectable: (id) => id !== "a" }),
    );
    act(() => result.current.onKeyDown(key("ArrowDown"))); // focus 0 ("a")
    act(() => result.current.onKeyDown(key(" ")));
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("ignores keys when the event target is an editable field", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS }),
    );
    act(() =>
      result.current.onKeyDown(key("ArrowDown", { target: { tagName: "INPUT" } })),
    );
    expect(result.current.focusedIndex).toBe(-1);
  });

  it("does nothing when disabled", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ itemIds: IDS, enabled: false }),
    );
    act(() => result.current.onKeyDown(key("ArrowDown")));
    expect(result.current.focusedIndex).toBe(-1);
  });

  it("prunes selection and clamps focus when items are removed", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useListKeyboardNav({ itemIds: ids }),
      { initialProps: { ids: IDS } },
    );
    act(() => result.current.onKeyDown(key("End"))); // focus 3
    act(() => result.current.selectAll());
    expect(result.current.selectedCount).toBe(4);

    rerender({ ids: ["a", "b"] });
    expect(result.current.focusedIndex).toBe(1); // clamped from 3
    expect(result.current.selectedCount).toBe(2); // c, d pruned
  });
});
