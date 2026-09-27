from __future__ import annotations

import numpy as np  # type: ignore
from typing import List, Optional, Tuple

from ..models import CalibrationInput, CalibrationResult, CalibrationPoint, PointResult

class CalibrationEngine:
    def __init__(self, data: CalibrationInput):
        self.data = data
        self.lrv = data.lrv
        self.urv = data.urv
        self.span = self.urv - self.lrv
        self.tolerance = data.tolerance_pct
        
        # Prepare arrays by averaging readings per point
        self.xi = np.array([p.set_point for p in data.points])
        self.y_up_avg = np.array([np.mean(p.readings_up) if p.readings_up else 0.0 for p in data.points])
        self.y_down_avg = np.array([np.mean(p.readings_down) if p.readings_down else 0.0 for p in data.points])
        
        # We use Y up avg for primary calculations
        self.yi = self.y_up_avg

    def calculate_basic(self) -> Tuple[np.ndarray, np.ndarray]:
        """Returns (Error per point, % Error of Span)"""
        if self.span == 0:
            return np.zeros_like(self.yi), np.zeros_like(self.yi)
        errors = self.yi - self.xi
        errors_pct_span = (errors / self.span) * 100
        return errors, errors_pct_span

    def calculate_statistics(self, errors: np.ndarray) -> Tuple[float, float, float]:
        """Returns (Mean, Std Dev, RMSE)"""
        if len(errors) == 0:
            return 0.0, 0.0, 0.0
        mean_err = np.mean(errors)
        std_dev = np.std(errors, ddof=1) if len(errors) > 1 else 0.0
        rmse = np.sqrt(np.mean(errors**2))
        return float(mean_err), float(std_dev), float(rmse)

    def calculate_linearity(self) -> Tuple[float, float, float]:
        """Returns (Slope, Intercept, Linearity Error %)"""
        if len(self.xi) < 2 or self.span == 0:
            return 1.0, 0.0, 0.0
        a, b = np.polyfit(self.xi, self.yi, 1) # y = ax + b
        y_pred = a * self.xi + b
        residuals = self.yi - y_pred
        linearity_err = (np.max(np.abs(residuals)) / self.span) * 100
        return float(a), float(b), float(linearity_err)

    def calculate_hysteresis(self) -> Optional[float]:
        if not self.data.points or not self.data.points[0].readings_down:
            return None
        h_points = np.abs(self.y_up_avg - self.y_down_avg)
        return float(np.max(h_points))

    def run_analysis(self) -> CalibrationResult:
        errors, errors_pct_span = self.calculate_basic()
        mean_err, std_dev, rmse = self.calculate_statistics(errors)
        slope, intercept, linearity_err = self.calculate_linearity()
        max_hysteresis = self.calculate_hysteresis()
        
        # Accuracy Evaluation
        max_abs_err_pct = np.max(np.abs(errors_pct_span)) if len(errors_pct_span) > 0 else 0.0
        
        # Zero and Span Check
        zero_error = (self.yi[0] - self.xi[0]) if len(self.yi) > 0 else 0.0
        span_error = ((self.yi[-1] - self.yi[0]) - self.span) if len(self.yi) > 1 else 0.0
        
        # Point Results
        point_results = []
        for i in range(len(self.xi)):
            readings = self.data.points[i].readings_up
            avg = float(self.yi[i])
            
            # Point Stats
            p_std = float(np.std(readings, ddof=1)) if len(readings) > 1 else 0.0
            p_repeat_err = float(np.max(np.abs(np.array(readings) - avg))) if readings else 0.0
            p_repeat_pct = (p_repeat_err / self.span * 100) if self.span != 0 else 0.0
            
            status = "PASS" if abs(errors_pct_span[i]) <= self.tolerance else "FAIL"
            point_results.append(PointResult(
                set_point=float(self.xi[i]),
                avg_reading=avg,
                readings=readings,
                error=float(errors[i]),
                error_pct_span=float(errors_pct_span[i]),
                std_dev=p_std,
                repeatability_error=p_repeat_err,
                repeatability_pct_span=p_repeat_pct,
                status=status
            ))
            
        overall_status = "PASS" if max_abs_err_pct <= self.tolerance else "FAIL"
        
        return CalibrationResult(
            span=self.span,
            max_error_pct_span=float(max_abs_err_pct),
            actual_accuracy_pct=float(max_abs_err_pct),
            mean_error=mean_err,
            std_dev=std_dev,
            rmse=rmse,
            linearity_error_pct=linearity_err,
            zero_error=float(zero_error),
            span_error=float(span_error),
            max_hysteresis=max_hysteresis,
            overall_status=overall_status,
            point_results=point_results
        )
