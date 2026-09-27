import matplotlib.pyplot as plt  # type: ignore
import numpy as np  # type: ignore
from typing import List, Optional
from ..models import CalibrationInput, CalibrationResult

class CalibrationCharts:
    def __init__(self, input_data: CalibrationInput, result: CalibrationResult):
        self.input_data = input_data
        self.result = result
        self.xi = np.array([p.set_point for p in input_data.points])
        self.yi = np.array([r.avg_reading for r in result.point_results])
        self.errors_pct = np.array([r.error_pct_span for r in result.point_results])
        
        # Professional Color Palette
        self.primary_color = '#0984e3'  # Ocean Blue
        self.secondary_color = '#d63031' # Soft Red
        self.accent_color = '#27ae60'   # Emerald Green
        self.bg_color = 'white'
        self.grid_color = '#dfe6e9'

    def _apply_pro_styling(self, ax, title, xlabel, ylabel):
        ax.set_title(title, fontsize=14, fontweight='bold', pad=15, color='#2d3436')
        ax.set_xlabel(xlabel, fontsize=10, fontweight='medium', color='#636e72')
        ax.set_ylabel(ylabel, fontsize=10, fontweight='medium', color='#636e72')
        ax.grid(True, linestyle='-', linewidth=0.5, color=self.grid_color, alpha=0.8)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.tick_params(labelsize=9, colors='#636e72')

    def plot_calibration_curve(self, ax: Optional[plt.Axes] = None):
        if ax is None:
            fig, ax = plt.subplots(figsize=(8, 6))
        
        ax.plot(self.xi, self.yi, marker='o', markersize=6, linestyle='-', linewidth=2, 
                color=self.primary_color, label='Measured Values', zorder=3)
        ax.plot([self.input_data.lrv, self.input_data.urv], 
                [self.input_data.lrv, self.input_data.urv], 
                color=self.secondary_color, linestyle='--', linewidth=1.5, 
                label='Ideal Linear (Reference)', alpha=0.7, zorder=2)
        
        self._apply_pro_styling(ax, 'Instrument Calibration Curve', 'Set Point Reference', 'Measured Feedback')
        ax.legend(frameon=True, facecolor='white', edgecolor=self.grid_color, loc='best')
        return ax

    def plot_error_curve(self, ax: Optional[plt.Axes] = None):
        if ax is None:
            fig, ax = plt.subplots(figsize=(8, 6))
        
        tol = self.input_data.tolerance_pct
        ax.plot(self.xi, self.errors_pct, marker='s', markersize=5, linestyle='-', 
                linewidth=2, color=self.accent_color, label='Span Error %', zorder=3)
        
        ax.axhline(y=tol, color=self.secondary_color, linestyle='--', linewidth=1.2, 
                   label=f'Upper Tol (±{tol}%)', alpha=0.6)
        ax.axhline(y=-tol, color=self.secondary_color, linestyle='--', linewidth=1.2, 
                   label=f'Lower Tol (±{tol}%)', alpha=0.6)
        ax.axhline(y=0, color='#2d3436', linewidth=1, alpha=0.4, zorder=1)
        
        # Fill tolerance zone
        ax.fill_between([min(self.xi), max(self.xi)], -tol, tol, color=self.accent_color, alpha=0.05, label='In-Spec Band')
        
        self._apply_pro_styling(ax, 'Percent Error Distribution', 'Set Point Reference', 'Error (% of Span)')
        ax.legend(frameon=True, facecolor='white', edgecolor=self.grid_color, loc='best')
        return ax

    def plot_residual_plot(self, ax: Optional[plt.Axes] = None):
        if ax is None:
            fig, ax = plt.subplots(figsize=(8, 6))
            
        a, b = np.polyfit(self.xi, self.yi, 1)
        y_pred = a * self.xi + b
        residuals = self.yi - y_pred
        
        ax.scatter(self.xi, residuals, color='#6c5ce7', s=40, edgecolors='white', linewidth=0.5, label='Residual Variance', zorder=3)
        ax.axhline(y=0, color='#2d3436', linewidth=1, alpha=0.4, zorder=1)
        
        self._apply_pro_styling(ax, 'Linearity Residual Analysis', 'Set Point Reference', 'Residual Variance')
        ax.legend(frameon=True, facecolor='white', edgecolor=self.grid_color, loc='best')
        return ax
