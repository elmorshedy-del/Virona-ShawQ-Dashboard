from __future__ import annotations

from typing import Any

import requests


def unwrap_hf_payload(payload: Any, *, endpoint_name: str) -> dict[str, Any]:
    if isinstance(payload, dict):
        for key in ("result", "output", "data"):
            candidate = payload.get(key)
            if isinstance(candidate, dict):
                return candidate
        return payload
    raise ValueError(f"{endpoint_name} endpoint returned an invalid response payload")


def post_hf_inputs(
    *,
    endpoint_url: str,
    api_token: str = "",
    inputs: dict[str, Any],
    timeout_sec: float,
    endpoint_name: str,
) -> dict[str, Any]:
    endpoint = str(endpoint_url or "").strip()
    if not endpoint:
        raise RuntimeError(f"{endpoint_name} endpoint is not configured")

    headers = {"Content-Type": "application/json"}
    bearer = str(api_token or "").strip()
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"

    response = requests.post(
        endpoint,
        headers=headers,
        json={"inputs": inputs},
        timeout=max(10.0, float(timeout_sec)),
    )
    response.raise_for_status()
    return unwrap_hf_payload(response.json(), endpoint_name=endpoint_name)
