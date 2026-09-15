# image-worker-python

HTTP image worker for segmentation stubs and **min-region inpaint** used by `@ai2live/image-client`.

## Run (no pip deps — stdlib)

```bash
cd services/image-worker-python
PYTHONPATH=src python -m ai2live_worker.main --host 127.0.0.1 --port 8090
```

Demo (no server):

```bash
PYTHONPATH=src python -m ai2live_worker.main --demo
PYTHONPATH=src python -m ai2live_worker.main --inpaint-demo /path/to/image.png /path/to/mask.png
```

## Optional OpenCV (recommended for dry-run inpaint quality)

```bash
pip install opencv-python-headless
# then POST /inpaint uses cv2.inpaint TELEA (fallback NS)
```

Without OpenCV the worker uses a pure-Python **telea-like** neighbor fill (stdlib PNG decode/encode).

## Optional FastAPI

```bash
pip install fastapi uvicorn
PYTHONPATH=src python -m ai2live_worker.main --fastapi --port 8090
```

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ status, service, version, capabilities }` |
| GET | `/capabilities` | — | `{ opencv_inpaint, telea_like, … }` |
| POST | `/segment` | `{ master_path, labels? }` | stub masks (+ `png_b64`) |
| POST | `/inpaint` | `{ image_path, mask_path }` | `{ method, png_b64, note }` |

`method` is one of: `opencv_inpaint` | `telea_like` | `stub`.

## Wire from TypeScript

```bash
export AI2LIVE_IMAGE_WORKER_URL=http://127.0.0.1:8090
# minRegionInpaint / inpaintViaWorker POST to the worker
```

Without the env var, the TS client falls back to in-process neighbor blend (or provider `imageEdit` when live).
