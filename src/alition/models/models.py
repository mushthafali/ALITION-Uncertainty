from __future__ import annotations
from typing import List, Optional

try:
    from pydantic import BaseModel, ConfigDict, Field  # type: ignore[import-untyped]
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "pydantic is required. Install it with: pip install pydantic"
    ) from exc


class CalibrationMetadata(BaseModel):
    """Metadata operator dan instrumen untuk satu sesi kalibrasi."""

    model_config = ConfigDict(frozen=False)

    operator_name: str
    instrument_model: str
    serial_number: str = ""
    tag_number: str = ""
    date: str
    location: str = ""
    calibration_standard: str = "Default"  # e.g. "Default", "DKD-R 6-1"


class CalibrationPoint(BaseModel):
    """Data bacaan mentah pada satu set-point kalibrasi."""

    model_config = ConfigDict(frozen=False)

    set_point: float
    readings_up: List[float] = Field(default_factory=list)
    readings_down: List[float] = Field(default_factory=list)


class CalibrationInput(BaseModel):
    """Seluruh parameter masukan untuk satu sesi kalibrasi."""

    model_config = ConfigDict(frozen=False)

    lrv: float
    urv: float
    tolerance_pct: float
    points: List[CalibrationPoint]
    ref_uncertainty: float = 0.0
    resolution: float = 0.0
    metadata: Optional[CalibrationMetadata] = None


class PointResult(BaseModel):
    """Hasil analisis pada satu set-point (rata-rata, error, status)."""

    model_config = ConfigDict(frozen=False)

    set_point: float
    avg_reading: float
    readings: List[float]
    error: float
    error_pct_span: float
    std_dev: float = 0.0
    repeatability_error: float = 0.0
    repeatability_pct_span: float = 0.0
    status: str  # PASS / FAIL


class CalibrationResult(BaseModel):
    """Ringkasan hasil kalibrasi keseluruhan."""

    model_config = ConfigDict(frozen=False)

    span: float
    max_error_pct_span: float
    actual_accuracy_pct: float
    mean_error: float
    std_dev: float
    rmse: float
    linearity_error_pct: float
    zero_error: float
    span_error: float
    max_hysteresis: Optional[float] = None
    overall_status: str  # PASS / FAIL
    point_results: List[PointResult]
