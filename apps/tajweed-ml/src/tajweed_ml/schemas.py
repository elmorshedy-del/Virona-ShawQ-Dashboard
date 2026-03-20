from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class RuleKind(str, Enum):
    TAFKHEEM = "tafkheem"
    TARQEEQ = "tarqeeq"
    MAKHRAJ = "makhraj"
    QALQALAH = "qalqalah"
    EMBEDDING = "embedding"
    MADD = "madd"
    GHUNNAH = "ghunnah"


class CheckResult(str, Enum):
    CORRECT = "correct"
    ERROR = "error"
    UNCERTAIN = "uncertain"


class RuleAnnotation(BaseModel):
    rule: RuleKind
    letter_index: int = 0
    letter: str | None = None
    expected_letter: str | None = None
    description_en: str | None = None
    description_ar: str | None = None


class TajweedCheckResult(BaseModel):
    rule: RuleKind
    result: CheckResult
    confidence: float = Field(ge=0.0, le=1.0)
    student_value: float | str | None = None
    expected_value: float | str | None = None
    word_index: int = 0
    letter_index: int = 0
    letter: str | None = None
    description_ar: str | None = None
    description_en: str | None = None
    detail: str


class CompareWordRequest(BaseModel):
    student_audio_path: str
    surah: int
    ayah: int
    word_index: int
    start_sec: float | None = None
    end_sec: float | None = None


class CheckRuleRequest(BaseModel):
    audio_path: str
    rule: RuleAnnotation
    surah: int | None = None
    ayah: int | None = None
    word_index: int = 0
    start_sec: float | None = None
    end_sec: float | None = None
