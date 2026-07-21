"""Unit tests for the mask-PNG -> percent-polygon conversion (_mask_to_polygon_pct)."""
from __future__ import annotations

import base64
import io

from PIL import Image

from pipeline_service.app import _mask_to_polygon_pct


def _mask_b64(rect=(30, 30, 70, 70), size=(100, 100)) -> str:
    """A white rectangle on black, PNG -> base64. Default = square from 30% to 70%."""
    im = Image.new("L", size, 0)
    x0, y0, x1, y1 = rect
    for y in range(y0, y1):
        for x in range(x0, x1):
            im.putpixel((x, y), 255)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_square_maps_to_percent_polygon():
    poly = _mask_to_polygon_pct(_mask_b64())
    assert isinstance(poly, list)
    # an axis-aligned square simplifies to ~4 corners
    assert 3 <= len(poly) <= 8
    # every vertex is percent-of-frame (resolution-free)
    assert all(0 <= p["x"] <= 100 and 0 <= p["y"] <= 100 for p in poly)
    xs = [p["x"] for p in poly]
    ys = [p["y"] for p in poly]
    # the contour hugs the 30..~70% square (last white pixel is 69 -> ~69–70%)
    assert 28 <= min(xs) <= 32 and 67 <= max(xs) <= 71
    assert 28 <= min(ys) <= 32 and 67 <= max(ys) <= 71


def test_non_square_resolution_still_percent():
    # wide frame: rect x 100..300 of 400 wide, y 50..150 of 200 tall -> 25..75% / 25..75%
    poly = _mask_to_polygon_pct(_mask_b64(rect=(100, 50, 300, 150), size=(400, 200)))
    assert poly and all(0 <= p["x"] <= 100 and 0 <= p["y"] <= 100 for p in poly)
    xs = [p["x"] for p in poly]
    assert 23 <= min(xs) <= 27 and 73 <= max(xs) <= 77


def test_empty_mask_returns_none():
    # all-black frame -> no contour
    im = Image.new("L", (60, 60), 0)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    assert _mask_to_polygon_pct(base64.b64encode(buf.getvalue()).decode()) is None


def test_bad_inputs_return_none():
    assert _mask_to_polygon_pct(None) is None
    assert _mask_to_polygon_pct("") is None
    assert _mask_to_polygon_pct("not-valid-base64-!!!") is None
    # valid base64 but not a PNG
    assert _mask_to_polygon_pct(base64.b64encode(b"nope").decode()) is None
