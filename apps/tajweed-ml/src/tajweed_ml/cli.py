from __future__ import annotations

import json
from pathlib import Path

import typer

from .audio import load_audio
from .checker import check_ghunnah, check_madd, load_checker
from .config import load_config
from .optional import MissingDependencyError, dependency_report
from .quran_text import load_quran_text
from .schemas import RuleAnnotation, RuleKind
from .segmenter import download_segmenter_model, load_segmenter

app = typer.Typer(help="Al-Tarteel Muaalem-based CLI")


def _echo_json(payload: object) -> None:
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))


def _run_or_exit(callback, *args, **kwargs):
    try:
        return callback(*args, **kwargs)
    except MissingDependencyError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    except Exception as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=1) from exc


@app.command("doctor")
def doctor() -> None:
    checker = _run_or_exit(load_checker)
    _echo_json(
        {
            "dependencies": dependency_report(),
            "config": load_config().as_dict(),
            "checker": checker.doctor_report(),
        }
    )


@app.command("setup-segmenter")
def setup_segmenter_command(
    cache_dir: Path | None = typer.Option(None, file_okay=False, dir_okay=True, writable=True),
) -> None:
    payload = _run_or_exit(download_segmenter_model, cache_dir)
    _echo_json(payload)


@app.command("segment-audio")
def segment_audio_command(
    audio_path: Path = typer.Argument(..., exists=True, file_okay=True, dir_okay=False),
    surah: int | None = typer.Option(None, min=1),
    ayah: int | None = typer.Option(None, min=1),
    chunk_length_s: float = typer.Option(15.0, min=1.0),
    stride_length_s: float = typer.Option(2.0, min=0.0),
    device: str = typer.Option(load_config().default_device),
) -> None:
    quran_data = load_quran_text()
    expected_words = quran_data.get(f"{surah}:{ayah}") if surah is not None and ayah is not None else None
    segmenter = _run_or_exit(load_segmenter, device)
    payload = _run_or_exit(
        segmenter.segment_audio,
        str(audio_path),
        transcript_words=expected_words,
        chunk_length_s=chunk_length_s,
        stride_length_s=stride_length_s,
    )
    _echo_json(payload)


@app.command("test-madd")
def test_madd_command(
    audio_path: Path = typer.Argument(..., exists=True, file_okay=True, dir_okay=False),
    reference_path: Path = typer.Argument(..., exists=True, file_okay=True, dir_okay=False),
) -> None:
    student_waveform, sample_rate = load_audio(audio_path)
    reference_waveform, _ = load_audio(reference_path, target_sample_rate=sample_rate)
    result = check_madd(
        student_waveform.squeeze(0).cpu().numpy(),
        reference_waveform.squeeze(0).cpu().numpy(),
        sr=sample_rate,
    )
    _echo_json(result)


@app.command("test-ghunnah")
def test_ghunnah_command(
    audio_path: Path = typer.Argument(..., exists=True, file_okay=True, dir_okay=False),
    reference_path: Path = typer.Argument(..., exists=True, file_okay=True, dir_okay=False),
) -> None:
    student_waveform, sample_rate = load_audio(audio_path)
    reference_waveform, _ = load_audio(reference_path, target_sample_rate=sample_rate)
    result = check_ghunnah(
        student_waveform.squeeze(0).cpu().numpy(),
        reference_waveform.squeeze(0).cpu().numpy(),
        sr=sample_rate,
    )
    _echo_json(result)


@app.command("check-rule")
def check_rule_command(
    audio_path: Path = typer.Option(..., exists=True, file_okay=True, dir_okay=False),
    rule_kind: RuleKind = typer.Option(..., "--rule"),
    letter: str | None = typer.Option(None),
    expected_letter: str | None = typer.Option(None),
    word_index: int = typer.Option(0, min=0),
    surah: int | None = typer.Option(None, min=1),
    ayah: int | None = typer.Option(None, min=1),
    start_sec: float | None = typer.Option(None),
    end_sec: float | None = typer.Option(None),
) -> None:
    checker = _run_or_exit(load_checker)
    result = _run_or_exit(
        checker.check_rule,
        str(audio_path),
        RuleAnnotation(
            rule=rule_kind,
            letter=letter,
            expected_letter=expected_letter,
        ),
        surah=surah,
        ayah=ayah,
        word_index=word_index,
        start_sec=start_sec,
        end_sec=end_sec,
    )
    _echo_json(result.model_dump())


@app.command("serve")
def serve_command(
    host: str = typer.Option(load_config().server_host),
    port: int = typer.Option(load_config().server_port),
) -> None:
    import uvicorn

    uvicorn.run("server.main:app", host=host, port=port, reload=False)
