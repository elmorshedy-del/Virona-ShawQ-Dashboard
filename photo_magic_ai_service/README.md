# Photo Magic AI Service (CPU)

Implements Photo Magic v1 backend models for Creative Studio:

- **Auto background removal:** BRIA **RMBG 2.0**
- **Precision background editor:** **SAM 2** point/box guided refinement
- **Magic Eraser (standard):** **LaMa** inpainting (TorchScript)

## ⚠️ Licensing note (RMBG 2.0)

The public `briaai/RMBG-2.0` model card indicates the weights are **non‑commercial by default** and require a
commercial agreement for production use. Review the model license before deploying commercially.

## Endpoints

- `GET /health`
- `POST /remove-bg/rmbg2`
- `POST /remove-bg/sam2-refine`
- `POST /erase/lama`

All endpoints accept/return **base64** images (no `data:` prefix required).

## Environment variables

- `PORT` (default: `5000`)
- `PHOTO_MAGIC_STRICT` (`true`/`false`, default: `true`)
- `PHOTO_MAGIC_DEVICE` (`cpu`/`cuda`, default: auto)
- `RMBG2_MODEL_ID` (default: `briaai/RMBG-2.0`)
- `SAM2_WEIGHTS_PATH` (default: `weights/sam2_hiera_large.pt`)
- `SAM2_WEIGHTS_URL` (default: FB public weights URL)
- `SAM2_CONFIG_NAME` (default: `configs/sam2/sam2_hiera_l.yaml`)
- `PHOTO_MAGIC_WARM_LAMA` (`1`/`0`, default: `1`) warm-download LaMa weights on boot

## Railway

This folder contains a `Dockerfile` + `railway.json` for a dedicated Railway service.

