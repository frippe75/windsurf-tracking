import { useEffect, useRef, useState } from "react";

export interface UseInViewOptions {
  /** IntersectionObserver rootMargin — pre-load slightly before entering view. */
  rootMargin?: string;
  /** IntersectionObserver threshold. */
  threshold?: number | number[];
  /** Once true, stay true (don't unload when scrolled back out). Default true. */
  once?: boolean;
}

/**
 * Reports whether the referenced element is (near) the viewport/scroll-container
 * via IntersectionObserver. Used to gate expensive work (e.g. backend thumbnail
 * requests) until an item actually scrolls into view.
 *
 * If IntersectionObserver is unavailable (very old/edge environments), the
 * element is treated as visible so behaviour degrades gracefully.
 */
export function useInView<T extends Element = HTMLDivElement>(
  options: UseInViewOptions = {},
): { ref: React.RefObject<T>; inView: boolean } {
  const { rootMargin = "200px", threshold = 0, once = true } = options;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, threshold, once]);

  return { ref, inView };
}
