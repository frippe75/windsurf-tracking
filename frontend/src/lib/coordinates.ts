/**
 * Coordinate conversions between the frontend's percentage space (0–100% of
 * the displayed video rect) and native video pixel space.
 *
 * Backend contract: click prompts and returned bboxes/masks are ALWAYS in
 * native video resolution. Percentages are a frontend-only display concept.
 */

export interface PctBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Percentage (0–100) click position → native pixel coordinates. */
export function pctToNative(
  xPct: number,
  yPct: number,
  nativeWidth: number,
  nativeHeight: number
): Point {
  return {
    x: Math.round((xPct / 100) * nativeWidth),
    y: Math.round((yPct / 100) * nativeHeight),
  };
}

/** Native-pixel corner bbox [x1, y1, x2, y2] → percentage bbox {x, y, w, h}. */
export function nativeBBoxToPct(
  corners: [number, number, number, number],
  nativeWidth: number,
  nativeHeight: number
): PctBBox {
  const [x1, y1, x2, y2] = corners;
  return {
    x: (x1 / nativeWidth) * 100,
    y: (y1 / nativeHeight) * 100,
    w: ((x2 - x1) / nativeWidth) * 100,
    h: ((y2 - y1) / nativeHeight) * 100,
  };
}

/** Rectangle polygon (4 corners, clockwise from top-left) from a pct bbox. */
export function bboxToPolygon(bbox: PctBBox): Point[] {
  return [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.w, y: bbox.y },
    { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
    { x: bbox.x, y: bbox.y + bbox.h },
  ];
}

/**
 * A mask image whose dimensions differ from the native video resolution is
 * treated as a cropped tile positioned at the bbox (VideoPlayer renders it
 * into the bbox rect instead of stretching it full-frame). Unknown dimensions
 * are treated as full-frame.
 */
export function isMaskCropped(
  maskWidth: number | undefined,
  maskHeight: number | undefined,
  nativeWidth: number,
  nativeHeight: number
): boolean {
  if (!maskWidth || !maskHeight || !nativeWidth || !nativeHeight) return false;
  return !(maskWidth === nativeWidth && maskHeight === nativeHeight);
}
