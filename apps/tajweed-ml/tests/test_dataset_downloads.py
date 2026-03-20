from __future__ import annotations

from pathlib import Path

from tajweed_ml import dataset_downloads


class _StubAudio:
    def __init__(self, **_kwargs):
        pass


class _StubDataset:
    def __init__(self, items=None):
        self._items = items or []
        self.column_names = ["audio"]
        self.saved_path: Path | None = None

    def save_to_disk(self, path):
        self.saved_path = Path(path)
        self.saved_path.mkdir(parents=True, exist_ok=True)

    def cast_column(self, _name, _value):
        return self

    def __iter__(self):
        return iter(self._items)

    def __len__(self):
        return len(self._items)


def test_download_buraaq_prefers_live_dataset_repo(tmp_path, monkeypatch) -> None:
    seen_repo_ids: list[str] = []
    dataset = _StubDataset([{"id": 1}])

    def fake_load_dataset(repo_id, split="train"):
        seen_repo_ids.append((repo_id, split))
        return dataset

    monkeypatch.setattr(
        dataset_downloads,
        "_load_dataset_dependencies",
        lambda: (_StubAudio, fake_load_dataset, object),
    )

    dataset_downloads.download_buraaq(tmp_path)

    assert seen_repo_ids == [(dataset_downloads.LIVE_BURAAQ_DATASET_ID, "train")]
    assert dataset.saved_path == tmp_path / "words"


def test_build_word_audio_index_supports_live_buraaq_schema(tmp_path, monkeypatch) -> None:
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"fake")
    dataset = _StubDataset(
        [
            {
                "surah_id": 1,
                "ayah_id": 1,
                "word_index": 0,
                "word_id": "1:1:1",
                "word_ar": "بِسْمِ",
                "audio": {"path": str(audio_path)},
            }
        ]
    )

    monkeypatch.setattr(
        dataset_downloads,
        "_load_dataset_dependencies",
        lambda: (_StubAudio, object, lambda _path: dataset),
    )

    result = dataset_downloads.build_word_audio_index(tmp_path)

    assert result["1:1:0"]["audio_path"] == str(audio_path.resolve())
    assert result["1:1:0"]["audio_word_path"] == "1:1:1"
    assert (tmp_path / "word_index.json").exists()


def test_resolve_buraaq_word_audio_path_materializes_embedded_audio(tmp_path) -> None:
    item = {
        "surah_id": 1,
        "ayah_id": 1,
        "word_index": 1,
        "audio": {"path": "001_001_001.mp3", "bytes": b"mp3-bytes"},
    }

    resolved_path = dataset_downloads.resolve_buraaq_word_audio_path(item, tmp_path)

    assert resolved_path.endswith("_materialized_audio/001_001_001.mp3")
    assert Path(resolved_path).read_bytes() == b"mp3-bytes"
