"""Min-region inpaint: OpenCV TELEA/NS when available, else pure-Python telea-like fill.

No hard dependency on OpenCV/Pillow — degrade gracefully and document method.
"""
from __future__ import annotations

import base64
import struct
import zlib
from typing import Any


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def encode_rgba_png(width: int, height: int, rgba: bytes) -> bytes:
    """Minimal RGBA PNG encoder (stdlib only)."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter none
        raw.extend(rgba[y * stride : (y + 1) * stride])
    compressed = zlib.compress(bytes(raw), 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + _png_chunk(b"IDAT", compressed)
        + _png_chunk(b"IEND", b"")
    )


def decode_png_rgba(data: bytes) -> tuple[int, int, bytearray]:
    """Decode 8-bit RGBA/RGB/GA/G PNG via stdlib. Raises on unsupported forms."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos = 8
    width = height = None
    idat = bytearray()
    color_type = 6
    bit_depth = 8
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, bit_depth, color_type, *_ = struct.unpack(">IIBBBBB", chunk)
        elif tag == b"IDAT":
            idat.extend(chunk)
        elif tag == b"IEND":
            break
    if width is None or height is None:
        raise ValueError("missing IHDR")
    if bit_depth != 8:
        raise ValueError(f"unsupported bit depth {bit_depth}")
    raw = zlib.decompress(bytes(idat))
    # bytes per pixel
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type)
    if bpp is None:
        raise ValueError(f"unsupported color type {color_type}")
    stride = width * bpp
    rows: list[bytearray] = []
    i = 0
    prev = bytearray(stride)
    for _y in range(height):
        filt = raw[i]
        i += 1
        row = bytearray(raw[i : i + stride])
        i += stride
        if filt == 1:  # Sub
            for x in range(bpp, stride):
                row[x] = (row[x] + row[x - bpp]) & 0xFF
        elif filt == 2:  # Up
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 0xFF
        elif filt == 3:  # Average
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) >> 1)) & 0xFF
        elif filt == 4:  # Paeth
            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                row[x] = (row[x] + pr) & 0xFF
        elif filt != 0:
            raise ValueError(f"unsupported filter {filt}")
        rows.append(row)
        prev = row
    rgba = bytearray(width * height * 4)
    for y, row in enumerate(rows):
        for x in range(width):
            o = (y * width + x) * 4
            if color_type == 6:
                s = x * 4
                rgba[o : o + 4] = row[s : s + 4]
            elif color_type == 2:
                s = x * 3
                rgba[o] = row[s]
                rgba[o + 1] = row[s + 1]
                rgba[o + 2] = row[s + 2]
                rgba[o + 3] = 255
            elif color_type == 4:
                s = x * 2
                g, a = row[s], row[s + 1]
                rgba[o] = rgba[o + 1] = rgba[o + 2] = g
                rgba[o + 3] = a
            elif color_type == 0:
                g = row[x]
                rgba[o] = rgba[o + 1] = rgba[o + 2] = g
                rgba[o + 3] = 255
            else:
                raise ValueError("palette PNG not supported")
    return width, height, rgba


def _try_opencv_inpaint(image_path: str, mask_path: str) -> dict[str, Any] | None:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        return None
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    mask_img = cv2.imread(mask_path, cv2.IMREAD_UNCHANGED)
    if img is None or mask_img is None:
        return {"error": "opencv_imread_failed"}
    if img.ndim == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None
    elif img.shape[2] == 4:
        bgr = img[:, :, :3]
        alpha = img[:, :, 3]
    else:
        bgr = img
        alpha = None
    if mask_img.ndim == 3:
        m = mask_img[:, :, 3] if mask_img.shape[2] == 4 else cv2.cvtColor(mask_img, cv2.COLOR_BGR2GRAY)
    else:
        m = mask_img
    if m.shape[:2] != bgr.shape[:2]:
        m = cv2.resize(m, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_NEAREST)
    bin_mask = (m > 127).astype("uint8") * 255
    # Prefer TELEA; fall back to NS
    try:
        filled = cv2.inpaint(bgr, bin_mask, 3, cv2.INPAINT_TELEA)
        algo = "telea"
    except Exception:
        filled = cv2.inpaint(bgr, bin_mask, 3, cv2.INPAINT_NS)
        algo = "ns"
    if alpha is not None:
        out_a = alpha.copy()
        out_a[bin_mask > 0] = 255
        out = np.dstack([filled, out_a])
    else:
        out = filled
    ok, buf = cv2.imencode(".png", out)
    if not ok:
        return None
    return {
        "method": "opencv_inpaint",
        "opencv_algo": algo,
        "png_b64": base64.b64encode(buf.tobytes()).decode("ascii"),
        "note": f"OpenCV inpaint ({algo}) on masked region only",
    }


def _telea_like_fill(width: int, height: int, rgba: bytearray, mask: bytearray) -> bytearray:
    """Iterative nearest-neighbor / distance-weighted fill (telea-like, no OpenCV)."""
    out = bytearray(rgba)
    # binary mask: 1 = needs fill
    need = [0] * (width * height)
    for i in range(width * height):
        need[i] = 1 if mask[i * 4 + 3] >= 128 else 0

    radii = (1, 2, 4, 8, 16, 32)
    # Multi-pass growing fill so interior gets values from newly filled border
    for _pass in range(4):
        snap = bytearray(out)
        for y in range(height):
            for x in range(width):
                p = y * width + x
                if not need[p]:
                    continue
                # skip if already filled in a previous pass with decent alpha
                oi = p * 4
                if _pass > 0 and out[oi + 3] >= 200 and need[p]:
                    # still refine below
                    pass
                found = False
                sr = sg = sb = sw = 0.0
                for rad in radii:
                    sr = sg = sb = sw = 0.0
                    for dy in range(-rad, rad + 1):
                        for dx in range(-rad, rad + 1):
                            nx, ny = x + dx, y + dy
                            if nx < 0 or ny < 0 or nx >= width or ny >= height:
                                continue
                            np_ = ny * width + nx
                            ni = np_ * 4
                            # Prefer known (non-mask) opaque pixels; allow previously filled
                            if snap[ni + 3] < 200:
                                continue
                            if need[np_] and (dx != 0 or dy != 0) and snap[ni + 3] < 220:
                                continue
                            dist = (dx * dx + dy * dy) ** 0.5 or 0.5
                            w = 1.0 / dist
                            sr += snap[ni] * w
                            sg += snap[ni + 1] * w
                            sb += snap[ni + 2] * w
                            sw += w
                    if sw > 0:
                        found = True
                        break
                if found and sw > 0:
                    out[oi] = int(sr / sw)
                    out[oi + 1] = int(sg / sw)
                    out[oi + 2] = int(sb / sw)
                    out[oi + 3] = 230

    # Soften mask border (poisson-ish average)
    for _ in range(2):
        snap = bytearray(out)
        for y in range(1, height - 1):
            for x in range(1, width - 1):
                p = y * width + x
                if not need[p]:
                    continue
                border = False
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if mask[((y + dy) * width + (x + dx)) * 4 + 3] < 128:
                            border = True
                            break
                    if border:
                        break
                if not border:
                    continue
                i = p * 4
                sr = sg = sb = sa = n = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ni = ((y + dy) * width + (x + dx)) * 4
                        sr += snap[ni]
                        sg += snap[ni + 1]
                        sb += snap[ni + 2]
                        sa += snap[ni + 3]
                        n += 1
                out[i] = int(0.45 * snap[i] + 0.55 * (sr / n))
                out[i + 1] = int(0.45 * snap[i + 1] + 0.55 * (sg / n))
                out[i + 2] = int(0.45 * snap[i + 2] + 0.55 * (sb / n))
                out[i + 3] = max(snap[i + 3], int(0.7 * snap[i + 3] + 0.3 * (sa / n)))
    return out


def inpaint_min_region(image_path: str, mask_path: str) -> dict[str, Any]:
    """Primary entry: try OpenCV, else telea-like stdlib fill on masked region."""
    cv = _try_opencv_inpaint(image_path, mask_path)
    if cv and cv.get("png_b64") and not cv.get("error"):
        return cv

    try:
        with open(image_path, "rb") as f:
            img_bytes = f.read()
        with open(mask_path, "rb") as f:
            mask_bytes = f.read()
        w, h, rgba = decode_png_rgba(img_bytes)
        mw, mh, mask = decode_png_rgba(mask_bytes)
        if (mw, mh) != (w, h):
            # Nearest-neighbor resize mask alpha to image size
            resized = bytearray(w * h * 4)
            for y in range(h):
                sy = min(mh - 1, y * mh // h)
                for x in range(w):
                    sx = min(mw - 1, x * mw // w)
                    si = (sy * mw + sx) * 4
                    di = (y * w + x) * 4
                    resized[di : di + 4] = mask[si : si + 4]
            mask = resized
        filled = _telea_like_fill(w, h, rgba, mask)
        png = encode_rgba_png(w, h, bytes(filled))
        note = "Pure-Python telea-like / neighbor fill (OpenCV not installed)"
        if cv and cv.get("error"):
            note += f"; opencv skipped: {cv['error']}"
        return {
            "method": "opencv_inpaint" if False else "telea_like",
            "png_b64": base64.b64encode(png).decode("ascii"),
            "note": note,
            "fallback_chain": ["opencv_inpaint", "telea_like"],
            "opencv_available": False,
        }
    except Exception as e:
        # Last resort: tiny PNG + note (TS client will neighbor_blend)
        tiny = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )
        return {
            "method": "stub",
            "png_b64": tiny,
            "note": f"inpaint failed ({e}); client should neighbor_blend",
            "error": str(e),
        }


def inpaint_capabilities() -> dict[str, Any]:
    opencv = False
    try:
        import cv2  # noqa: F401

        opencv = True
    except ImportError:
        opencv = False
    return {
        "opencv_inpaint": opencv,
        "telea_like": True,
        "neighbor_blend_client": True,
        "note": "Install opencv-python-headless for TELEA/NS; else telea_like stdlib fill",
    }
