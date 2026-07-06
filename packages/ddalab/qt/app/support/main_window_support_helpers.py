from __future__ import annotations

import math
import sys
from typing import Callable, Dict, List, Optional

from PySide6.QtCore import (
    QSignalBlocker,
    Qt,
    Signal,
    QObject,
)
from PySide6.QtWidgets import (
    QComboBox,
    QCompleter,
    QListWidget,
    QListWidgetItem,
    QStyle,
    QStyleOptionViewItem,
    QWidget,
)

from ...domain.models import (
    DdaResult,
    DdaVariantResult,
)
from ...ui.plot_layers import PlotLayerConfig


class WorkerSignals(QObject):
    success = Signal(object)
    error = Signal(str)
    progress = Signal(object)


class ToggleListWidget(QListWidget):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._pressed_item: Optional[QListWidgetItem] = None
        self._pressed_on_indicator = False

    def mousePressEvent(self, event) -> None:  # type: ignore[override]
        item = self.itemAt(event.position().toPoint())
        self._pressed_item = item
        self._pressed_on_indicator = (
            self._is_on_check_indicator(item, event.position().toPoint())
            if item
            else False
        )
        super().mousePressEvent(event)

    def mouseReleaseEvent(self, event) -> None:  # type: ignore[override]
        item = self.itemAt(event.position().toPoint())
        should_toggle = (
            event.button() == Qt.LeftButton
            and item is not None
            and item is self._pressed_item
            and not self._pressed_on_indicator
            and bool(item.flags() & Qt.ItemIsUserCheckable)
        )
        super().mouseReleaseEvent(event)
        if should_toggle:
            item.setCheckState(
                Qt.Unchecked if item.checkState() == Qt.Checked else Qt.Checked
            )
        self._pressed_item = None
        self._pressed_on_indicator = False

    def _is_on_check_indicator(self, item: Optional[QListWidgetItem], point) -> bool:
        if item is None:
            return False
        option = QStyleOptionViewItem()
        option.initFrom(self)
        option.rect = self.visualItemRect(item)
        option.features |= QStyleOptionViewItem.HasCheckIndicator
        option.checkState = item.checkState()
        indicator_rect = self.style().subElementRect(
            QStyle.SE_ItemViewItemCheckIndicator, option, self
        )
        return indicator_rect.contains(point)


def _plot_layer_payload(
    layers: PlotLayerConfig,
    names: tuple[str, ...],
) -> dict[str, bool]:
    return {name: bool(getattr(layers, name)) for name in names}


def _plot_layer_config_from_payload(
    payload: dict,
    names: tuple[str, ...],
) -> PlotLayerConfig:
    values = {
        name: bool(payload[name])
        for name in names
        if isinstance(payload.get(name), bool)
    }
    return PlotLayerConfig(**values)


def _normalized_selector_text(value: object) -> str:
    return " ".join(str(value).strip().lower().split())


def filter_text_choices(values: list[str], query: str) -> list[str]:
    tokens = [token for token in _normalized_selector_text(query).split(" ") if token]
    if not tokens:
        return list(values)
    return [
        value
        for value in values
        if all(token in _normalized_selector_text(value) for token in tokens)
    ]


def _list_widget_item_filter_text(item: QListWidgetItem) -> str:
    label = str(item.text())
    user_value = item.data(Qt.UserRole)
    if isinstance(user_value, str) and user_value:
        return f"{label} {user_value}"
    if isinstance(user_value, (tuple, list)):
        joined = " ".join(str(part) for part in user_value)
        return f"{label} {joined}"
    return label


def apply_list_widget_filter(
    list_widget: QListWidget,
    query: str,
    *,
    text_getter: Callable[[QListWidgetItem], str] | None = None,
) -> int:
    matcher = text_getter or _list_widget_item_filter_text
    tokens = [token for token in _normalized_selector_text(query).split(" ") if token]
    visible_count = 0
    for index in range(list_widget.count()):
        item = list_widget.item(index)
        haystack = _normalized_selector_text(matcher(item))
        is_visible = all(token in haystack for token in tokens)
        item.setHidden(not is_visible)
        if is_visible:
            visible_count += 1
    return visible_count


def set_check_state_for_list_items(
    list_widget: QListWidget,
    state: Qt.CheckState,
    *,
    visible_only: bool = True,
) -> int:
    changed = 0
    with QSignalBlocker(list_widget):
        for index in range(list_widget.count()):
            item = list_widget.item(index)
            if visible_only and item.isHidden():
                continue
            if not bool(item.flags() & Qt.ItemIsUserCheckable):
                continue
            if item.checkState() == state:
                continue
            item.setCheckState(state)
            changed += 1
    return changed


def select_list_widget_items(
    list_widget: QListWidget,
    *,
    selected: bool,
    visible_only: bool = True,
) -> int:
    changed = 0
    with QSignalBlocker(list_widget):
        for index in range(list_widget.count()):
            item = list_widget.item(index)
            if visible_only and item.isHidden():
                continue
            if item.isSelected() == selected:
                continue
            item.setSelected(selected)
            changed += 1
    return changed


def configure_searchable_combo_box(
    combo_box: QComboBox,
    *,
    placeholder: str,
) -> None:
    combo_box.setEditable(True)
    combo_box.setInsertPolicy(QComboBox.NoInsert)
    line_edit = combo_box.lineEdit()
    if line_edit is not None:
        line_edit.setPlaceholderText(placeholder)
        line_edit.setClearButtonEnabled(False)
    completer = combo_box.completer()
    if completer is None:
        completer = QCompleter(combo_box.model(), combo_box)
        combo_box.setCompleter(completer)
    completer.setCaseSensitivity(Qt.CaseInsensitive)
    completer.setFilterMode(Qt.MatchContains)
    completer.setCompletionMode(QCompleter.PopupCompletion)


def current_combo_box_value(combo_box: QComboBox) -> str:
    raw_text = combo_box.currentText().strip()
    if raw_text:
        normalized_text = raw_text.casefold()
        for index in range(combo_box.count()):
            item_text = combo_box.itemText(index).strip()
            if item_text.casefold() != normalized_text:
                continue
            exact_data = combo_box.itemData(index)
            if isinstance(exact_data, str) and exact_data.strip():
                return exact_data.strip()
            if item_text:
                return item_text
        return raw_text
    raw_data = combo_box.currentData()
    if isinstance(raw_data, str) and raw_data.strip():
        return raw_data.strip()
    return raw_text


def sync_searchable_combo_box_selection(
    combo_box: QComboBox,
    *,
    preferred_value: str | None = None,
) -> None:
    if combo_box.count() <= 0:
        combo_box.setCurrentIndex(-1)
        line_edit = combo_box.lineEdit()
        if line_edit is not None:
            line_edit.clear()
        return
    target_index = 0
    if preferred_value:
        normalized_preferred = preferred_value.strip().casefold()
        for index in range(combo_box.count()):
            candidate_text = combo_box.itemText(index).strip()
            candidate_data = combo_box.itemData(index)
            candidate_value = (
                str(candidate_data).strip()
                if isinstance(candidate_data, str) and candidate_data.strip()
                else candidate_text
            )
            if candidate_value.casefold() == normalized_preferred:
                target_index = index
                break
    combo_box.setCurrentIndex(target_index)
    line_edit = combo_box.lineEdit()
    if line_edit is not None:
        line_edit.setText(combo_box.itemText(target_index))


def _human_bytes(size_bytes: Optional[int]) -> str:
    if not size_bytes:
        return "—"
    value = float(size_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024.0 or unit == "TB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024.0
    return f"{size_bytes} B"


def _system_reveal_label() -> str:
    if sys.platform == "darwin":
        return "Reveal in Finder"
    if sys.platform.startswith("win"):
        return "Show in Explorer"
    return "Show in Folder"


def _mean_absolute(values: List[float]) -> float:
    if not values:
        return 0.0
    finite = [abs(float(value)) for value in values if math.isfinite(float(value))]
    if not finite:
        return 0.0
    return sum(finite) / len(finite)


def _variant_mean_absolute(variant: DdaVariantResult) -> float:
    if variant.row_mean_absolute:
        finite = [
            float(value)
            for value in variant.row_mean_absolute
            if math.isfinite(float(value))
        ]
        if finite:
            return sum(finite) / len(finite)
        return 0.0
    return _mean_absolute([value for row in variant.matrix for value in row])


def _build_connectivity_metrics(variant: DdaVariantResult) -> List[dict]:
    metrics: List[dict] = []
    for index, label in enumerate(variant.row_labels):
        row = variant.matrix[index] if index < len(variant.matrix) else []
        if not row:
            continue
        metrics.append(
            {
                "label": label,
                "mean_absolute": variant.row_mean_absolute_value(index),
                "peak_absolute": variant.row_peak_absolute_value(index),
            }
        )
    return sorted(metrics, key=lambda item: item["mean_absolute"], reverse=True)


def _row_mean_abs_map(variant: DdaVariantResult) -> Dict[str, float]:
    values: Dict[str, float] = {}
    for index, label in enumerate(variant.row_labels):
        values[label] = variant.row_mean_absolute_value(index)
    return values


def _build_variant_comparisons(baseline: DdaResult, target: DdaResult) -> List[dict]:
    baseline_by_id = {variant.id: variant for variant in baseline.variants}
    target_by_id = {variant.id: variant for variant in target.variants}
    comparisons: List[dict] = []
    for variant_id in sorted(set(baseline_by_id) & set(target_by_id)):
        baseline_variant = baseline_by_id[variant_id]
        target_variant = target_by_id[variant_id]
        baseline_rows = _row_mean_abs_map(baseline_variant)
        target_rows = _row_mean_abs_map(target_variant)
        shared_rows = set(baseline_rows) & set(target_rows)
        top_changed_row = None
        if shared_rows:
            top_changed_row = max(
                shared_rows,
                key=lambda label: abs(target_rows[label] - baseline_rows[label]),
            )
        baseline_mean = _variant_mean_absolute(baseline_variant)
        target_mean = _variant_mean_absolute(target_variant)
        comparisons.append(
            {
                "variant_id": variant_id,
                "baseline_mean_abs": baseline_mean,
                "target_mean_abs": target_mean,
                "delta": target_mean - baseline_mean,
                "shared_row_count": len(shared_rows),
                "top_changed_row": top_changed_row,
            }
        )
    return comparisons
