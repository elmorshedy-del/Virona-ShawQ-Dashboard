"""Local Hydra config package for SAM 2.

We vendor the minimal configs needed by `sam2.build_sam.build_sam2` so the service
can run in containerized environments where the upstream package may omit config
files from the built wheel.
"""

