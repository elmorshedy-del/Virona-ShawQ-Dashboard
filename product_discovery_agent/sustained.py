"""Sustained trend scoring helpers."""

from __future__ import annotations

from dataclasses import dataclass

from .constants import (
    COMPONENT_SCORE_CAP,
    SUSTAINED_DIRECTION_THRESHOLDS,
    SUSTAINED_BASELINE_DENOMINATOR_FLOOR,
    SUSTAINED_GROWTH_STRONG,
    SUSTAINED_SCORE_COMPONENT_WEIGHTS,
    SUSTAINED_SLOPE_STRONG,
)


@dataclass(slots=True)
class SustainedTrendMetrics:
    points_count: int
    recent_average: float
    baseline_average: float
    growth_rate: float
    slope_per_point: float
    consistency_ratio: float
    sustained_score: float
    direction: str


def compute_sustained_trend_metrics(
    *,
    values: list[int],
    recent_points: int,
    baseline_points: int,
) -> SustainedTrendMetrics | None:
    if len(values) < (recent_points + baseline_points):
        return None

    recent_slice = values[-recent_points:]
    baseline_slice = values[-(recent_points + baseline_points) : -recent_points]
    if not baseline_slice:
        return None

    recent_average = _mean(recent_slice)
    baseline_average = _mean(baseline_slice)
    growth_rate = (recent_average - baseline_average) / max(
        SUSTAINED_BASELINE_DENOMINATOR_FLOOR,
        baseline_average,
    )
    slope_per_point = _linear_slope(values)
    consistency_ratio = _consistency_ratio(values)
    sustained_score = _score_sustained_metrics(
        growth_rate=growth_rate,
        slope_per_point=slope_per_point,
        consistency_ratio=consistency_ratio,
    )
    direction = _classify_direction(
        growth_rate=growth_rate,
        slope_per_point=slope_per_point,
        consistency_ratio=consistency_ratio,
    )
    return SustainedTrendMetrics(
        points_count=len(values),
        recent_average=recent_average,
        baseline_average=baseline_average,
        growth_rate=growth_rate,
        slope_per_point=slope_per_point,
        consistency_ratio=consistency_ratio,
        sustained_score=sustained_score,
        direction=direction,
    )


def _score_sustained_metrics(
    *,
    growth_rate: float,
    slope_per_point: float,
    consistency_ratio: float,
) -> float:
    growth_normalized = _clamp(growth_rate / SUSTAINED_GROWTH_STRONG, lower=-1.0, upper=1.0)
    slope_normalized = _clamp(slope_per_point / SUSTAINED_SLOPE_STRONG, lower=-1.0, upper=1.0)
    consistency_normalized = _clamp((consistency_ratio - 0.5) / 0.5, lower=-1.0, upper=1.0)
    weighted = (
        growth_normalized * SUSTAINED_SCORE_COMPONENT_WEIGHTS["growth"]
        + slope_normalized * SUSTAINED_SCORE_COMPONENT_WEIGHTS["slope"]
        + consistency_normalized * SUSTAINED_SCORE_COMPONENT_WEIGHTS["consistency"]
    )
    raw_score = ((weighted + 1.0) / 2.0) * COMPONENT_SCORE_CAP
    return _clamp(raw_score, lower=0.0, upper=COMPONENT_SCORE_CAP)


def _classify_direction(
    *,
    growth_rate: float,
    slope_per_point: float,
    consistency_ratio: float,
) -> str:
    if (
        growth_rate >= SUSTAINED_DIRECTION_THRESHOLDS["accelerating_growth_min"]
        and slope_per_point >= SUSTAINED_DIRECTION_THRESHOLDS["accelerating_slope_min"]
        and consistency_ratio >= SUSTAINED_DIRECTION_THRESHOLDS["accelerating_consistency_min"]
    ):
        return "accelerating"
    if (
        growth_rate >= SUSTAINED_DIRECTION_THRESHOLDS["steady_growth_min"]
        and slope_per_point >= SUSTAINED_DIRECTION_THRESHOLDS["steady_slope_min"]
    ):
        return "steady_up"
    if (
        growth_rate <= SUSTAINED_DIRECTION_THRESHOLDS["declining_growth_max"]
        or slope_per_point <= SUSTAINED_DIRECTION_THRESHOLDS["declining_slope_max"]
    ):
        return "declining"
    return "flat"


def _linear_slope(values: list[int]) -> float:
    count = len(values)
    if count < 2:
        return 0.0
    x_mean = (count - 1) / 2.0
    y_mean = _mean(values)
    numerator = 0.0
    denominator = 0.0
    for index, value in enumerate(values):
        x_delta = index - x_mean
        numerator += x_delta * (value - y_mean)
        denominator += x_delta * x_delta
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def _consistency_ratio(values: list[int]) -> float:
    if len(values) < 2:
        return 0.5
    non_decreasing_steps = 0
    total_steps = 0
    for previous, current in zip(values, values[1:]):
        total_steps += 1
        if current >= previous:
            non_decreasing_steps += 1
    if total_steps == 0:
        return 0.5
    return non_decreasing_steps / total_steps


def _mean(values: list[int] | list[float]) -> float:
    if not values:
        return 0.0
    return float(sum(values)) / float(len(values))


def _clamp(value: float, *, lower: float, upper: float) -> float:
    if value < lower:
        return lower
    if value > upper:
        return upper
    return value
