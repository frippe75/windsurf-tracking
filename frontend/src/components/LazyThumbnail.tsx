import { useInView } from "@/hooks/useInView";

interface LazyThumbnailProps {
  /**
   * The resolved thumbnail URL. It is only applied to the <img> `src` once the
   * element scrolls into view, so callers can pass an expensive backend
   * frame-extraction URL without triggering a request up-front.
   */
  src: string;
  alt: string;
  /** Class applied to the <img> once loaded. */
  className?: string;
  /** Class applied to the wrapper (controls the reserved box size). */
  wrapperClassName?: string;
}

/**
 * Renders a placeholder box until the element is (near) visible, then sets the
 * image `src`. Combines an IntersectionObserver gate with native
 * `loading="lazy"` (native lazy alone is unreliable inside scroll containers).
 *
 * This prevents the "thundering herd" of simultaneous backend frame-extraction
 * requests when a large video library is opened: only visible items fetch.
 */
export function LazyThumbnail({
  src,
  alt,
  className = "w-full h-full object-cover",
  wrapperClassName = "w-full h-full",
}: LazyThumbnailProps) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div ref={ref} className={wrapperClassName}>
      {inView && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={className}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}
