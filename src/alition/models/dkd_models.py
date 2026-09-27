from enum import Enum
from typing import Optional
import math

try:
    from pydantic import BaseModel, ConfigDict, Field
except ImportError as exc:
    raise ImportError(
        "pydantic is required. Install it with: pip install pydantic"
    ) from exc


class UnitFactor(float, Enum):
    PA = 1.0
    BAR = 100000.0
    PSI = 6894.757
    KPA = 1000.0
    MPA = 1000000.0
    MBAR = 100.0
    HPA = 100.0


class CalibratorType(str, Enum):
    DIGITAL = "DIGITAL"
    DWT = "DWT"


class SequenceType(str, Enum):
    A = "A"  # 9 titik, 3x preload, M1-M6
    B = "B"  # 9 titik, 2x preload, M1-M4
    C = "C"  # 5 titik, 1x preload, M1-M2


class DKDCalibrationSetup(BaseModel):
    """
    Fase 1: Setup & Inisialisasi untuk Kalibrasi DKD-R 6-1
    Menggunakan Arsitektur "Base Unit" (Pascal)
    """

    model_config = ConfigDict(frozen=False)

    # A. INPUT MANUAL & UNIT
    input_unit: str = "bar"  # "bar", "psi", "kPa", "MPa", "Pa", "mbar", "hPa"

    # Parameter Alat yang Diuji (UUT)
    lrv: float
    urv: float
    resolution: float
    mpe_percent: float  # Toleransi dalam persentase (%)

    # Tipe Kalibrator
    calibrator_type: CalibratorType

    # Parameter Ekstra (Selalu ada)
    height_diff: float = 0.0  # Positif jika UUT lebih tinggi (meter)
    medium_density: float = 1.2  # kg/m^3 (udara=~1.2, air=~1000)

    # Parameter DIGITAL (dibutuhkan jika tipe DIGITAL)
    std_full_scale: Optional[float] = None
    std_accuracy_percent: Optional[float] = None

    # Parameter DWT dari sertifikat (dibutuhkan jika tipe DWT)
    u_standard_dwt: Optional[float] = None
    alpha_beta: Optional[float] = None  # Koefisien pemuaian termal (1/K)
    rho_m: Optional[float] = None  # Densitas massa beban pelat (kg/m^3)
    lambda_val: Optional[float] = None  # Koefisien deformasi (1/Pa)

    @property
    def faktor_masuk(self) -> float:
        """Mengembalikan faktor pengali untuk konversi ke Pascal."""
        unit = self.input_unit.upper()
        if unit == "BAR":
            return UnitFactor.BAR.value
        if unit == "PSI":
            return UnitFactor.PSI.value
        if unit == "KPA":
            return UnitFactor.KPA.value
        if unit == "MPA":
            return UnitFactor.MPA.value
        if unit == "MBAR":
            return UnitFactor.MBAR.value
        if unit == "HPA":
            return UnitFactor.HPA.value
        return UnitFactor.PA.value

    # B. KONVERSI KE BASE UNIT (PASCAL)
    @property
    def lrv_pa(self) -> float:
        return self.lrv * self.faktor_masuk

    @property
    def urv_pa(self) -> float:
        return self.urv * self.faktor_masuk

    @property
    def resolution_pa(self) -> float:
        return self.resolution * self.faktor_masuk

    @property
    def mpe_value_pa(self) -> float:
        return (self.mpe_percent / 100.0) * (self.urv_pa - self.lrv_pa)

    # C. ALAT REFERENSI & u_standard
    @property
    def u_standard_pa(self) -> float:
        """Menghitung nilai u_standard dalam Pascal berdasarkan tipe kalibrator."""
        if self.calibrator_type == CalibratorType.DIGITAL:
            if self.std_full_scale is None or self.std_accuracy_percent is None:
                raise ValueError("Kalibrator DIGITAL memerlukan std_full_scale dan std_accuracy_percent")
            std_fs_pa = self.std_full_scale * self.faktor_masuk
            return ((self.std_accuracy_percent / 100.0) * std_fs_pa) / math.sqrt(3)

        elif self.calibrator_type == CalibratorType.DWT:
            if self.u_standard_dwt is None:
                raise ValueError("Kalibrator DWT memerlukan u_standard_dwt dari sertifikat")
            return self.u_standard_dwt * self.faktor_masuk

        return 0.0

    # D. LOGIKA PENGUNCI SEQUENCE
    @property
    def locked_sequence(self) -> SequenceType:
        """Mengevaluasi Sequence kalibrasi (A, B, atau C) secara otomatis."""
        # URV > 2500 bar (250,000,000 Pa)
        if self.mpe_percent < 0.1 or self.urv_pa > 250000000.0:
            return SequenceType.A
        elif 0.1 <= self.mpe_percent <= 0.6:
            return SequenceType.B
        else:
            return SequenceType.C
