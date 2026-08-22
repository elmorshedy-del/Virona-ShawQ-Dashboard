# Photo Magic HQ Service (GPU)

High-quality **Magic Eraser** backend using **SDXL Inpainting** (`diffusers/stable-diffusion-xl-1.0-inpainting-0.1`).

## Endpoints

- `GET /health`
- `POST /erase/sdxl`

## Notes

- This service is intended to run on a **GPU**. By default it will report **not ready** on CPU.
- Set `PHOTO_MAGIC_HQ_ALLOW_CPU=true` only for development/testing.

