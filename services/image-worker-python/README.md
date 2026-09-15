# image-worker-python

HTTP image worker for segmentation and inpaint stubs used by `@ai2live/image-client`.

## Run (no pip deps — stdlib)

```bash
cd services/image-worker-python
PYTHONPATH=src python -m ai2live_worker.main --host 127.0.0.1 --port 8090
```

Demo (no server):

```bash
PYTHONPATH=src python -m ai2live_worker.main --demo
```

## Optional FastAPI

```bash
pip install fastapi uvicorn
PYTHONPATH=src python -m ai2live_worker.main --fastapi --port 8090
```

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ status, service, version }` |
| POST | `/segment` | `{ master_path, labels? }` | stub masks (+ `png_b64`) |
| POST | `/inpaint` | `{ image_path, mask_path }` | stub result (+ `png_b64`) |

## Wire from TypeScript

```bash
export AI2LIVE_IMAGE_WORKER_URL=http://127.0.0.1:8090
# then image-client segmentViaWorker / inpaintViaWorker will POST to the worker
```

Without the env var, the TS client writes local stub masks under `masks/`.
