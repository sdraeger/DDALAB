from __future__ import annotations

from .main_window_support_browser import MainWindowSupportBrowserMixin
from .main_window_support_helpers import (
    ToggleListWidget,
    WorkerSignals,
    _build_connectivity_metrics,
    _build_variant_comparisons,
    _human_bytes,
    apply_list_widget_filter,
    configure_searchable_combo_box,
    current_combo_box_value,
    filter_text_choices,
    select_list_widget_items,
    set_check_state_for_list_items,
    sync_searchable_combo_box_selection,
)
from .main_window_support_restore import MainWindowSupportRestoreMixin
from .main_window_support_results import MainWindowSupportResultsMixin
from .main_window_support_session import MainWindowSupportSessionMixin


class MainWindowSupportMixin(
    MainWindowSupportSessionMixin,
    MainWindowSupportBrowserMixin,
    MainWindowSupportResultsMixin,
    MainWindowSupportRestoreMixin,
):
    pass


__all__ = [
    "MainWindowSupportMixin",
    "ToggleListWidget",
    "WorkerSignals",
    "_build_connectivity_metrics",
    "_build_variant_comparisons",
    "_human_bytes",
    "apply_list_widget_filter",
    "configure_searchable_combo_box",
    "current_combo_box_value",
    "filter_text_choices",
    "select_list_widget_items",
    "set_check_state_for_list_items",
    "sync_searchable_combo_box_selection",
]
