"""Image worker stub.

M1+: expose /segment and /inpaint when FastAPI is installed.
Until then, TypeScript @ai2live/segmentation provides see-through fallback.
"""

from __future__ import annotations


def segment_stub(master_path: str, labels: list[str] | None = None) -> dict:
    return {
        "method": "stub",
        "master_path": master_path,
        "labels": labels or [],
        "masks": [],
        "note": "Install FastAPI + CV deps for real segmentation",
    }


def inpaint_stub(image_path: str, mask_path: str) -> dict:
    return {
        "method": "stub",
        "image_path": image_path,
        "mask_path": mask_path,
        "note": "Occlusion inpaint deferred to TS deterministic dilate in M2",
    }


def main() -> None:
    print("ai2live image-worker stub")
    print(segment_stub("design/master_neutral.png"))


if __name__ == "__main__":
    main()
