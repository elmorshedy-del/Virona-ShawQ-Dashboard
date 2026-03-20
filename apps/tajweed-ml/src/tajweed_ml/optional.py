from __future__ import annotations

import importlib


OPTIONAL_DEPENDENCIES = {
    "boto3": "boto3",
    "datasets": "datasets",
    "diff-match-patch": "diff_match_patch",
    "fastapi": "fastapi",
    "fuzzysearch": "fuzzysearch",
    "huggingface-hub": "huggingface_hub",
    "levenshtein": "Levenshtein",
    "librosa": "librosa",
    "numpy": "numpy",
    "parselmouth": "parselmouth",
    "pydantic": "pydantic",
    "python_multipart": "multipart",
    "pydub": "pydub",
    "rich": "rich",
    "scikit-learn": "sklearn",
    "scipy": "scipy",
    "soundfile": "soundfile",
    "torch": "torch",
    "torchaudio": "torchaudio",
    "transformers": "transformers",
    "uvicorn": "uvicorn",
    "websockets": "websockets",
    "xmltodict": "xmltodict",
}


class MissingDependencyError(RuntimeError):
    """Raised when optional ML dependencies are needed but unavailable."""


def require_dependency(module_name: str, package_name: str | None = None):
    try:
        return importlib.import_module(module_name)
    except ImportError as exc:  # pragma: no cover - depends on local environment
        install_name = package_name or module_name
        raise MissingDependencyError(
            f"Missing optional dependency '{module_name}'. Install with: pip install -e '.[ml]' "
            f"or pip install {install_name}"
        ) from exc


def dependency_report() -> dict[str, bool]:
    report: dict[str, bool] = {}
    for label, module_name in OPTIONAL_DEPENDENCIES.items():
        try:
            importlib.import_module(module_name)
        except ImportError:
            report[label] = False
        else:
            report[label] = True
    return report
