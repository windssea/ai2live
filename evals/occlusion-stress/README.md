# Occlusion Stress Eval

Synthetic fixture with intentional missing under-layer pixels for three scenarios:

1. bangs under face (forehead)
2. face over back hair
3. body over arm root

Runner compares completion opaque coverage vs the see-through (visible-only) baseline and writes `validation/occlusion_stress_report.json`.
