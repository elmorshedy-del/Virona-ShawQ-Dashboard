#!/bin/sh
set -eu

echo "[photo_magic_hq_service] Starting backend..."
exec python backend.py

