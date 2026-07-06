from __future__ import annotations


from .main_window_analysis_batch import MainWindowAnalysisBatchMixin
from .main_window_analysis_compare import MainWindowAnalysisCompareMixin
from .main_window_analysis_config import MainWindowAnalysisConfigMixin
from .main_window_analysis_results import MainWindowAnalysisResultsMixin
from .main_window_analysis_variants import MainWindowAnalysisVariantsMixin


class MainWindowAnalysisMixin(
    MainWindowAnalysisConfigMixin,
    MainWindowAnalysisVariantsMixin,
    MainWindowAnalysisResultsMixin,
    MainWindowAnalysisBatchMixin,
    MainWindowAnalysisCompareMixin,
):
    DDA_VARIANT_ORDER = ("ST", "SY", "DE", "CT", "CD")
    DDA_SINGLE_CHANNEL_VARIANTS = ("ST", "SY", "DE")
    DDA_PAIR_VARIANTS = ("CT", "CD")
    COMPARE_VIEW_MODE_ORDER = ("summary", "heatmaps", "lines", "stats")
    DDA_DEFAULT_DELAYS = (7, 10)
    DDA_DEFAULT_MODEL_TERMS = (1, 2, 10)
    DDA_DEFAULT_MODEL_DIMENSION = 4
    DDA_DEFAULT_POLYNOMIAL_ORDER = 4
    DDA_DEFAULT_NR_TAU = 2
