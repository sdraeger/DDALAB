from __future__ import annotations

from typing import Dict, List, Optional

from PySide6.QtCore import QSignalBlocker, Qt
from PySide6.QtWidgets import (
    QListWidgetItem,
)

from ..support.main_window_support import (
    apply_list_widget_filter,
    current_combo_box_value,
    filter_text_choices,
    set_check_state_for_list_items,
)


from .main_window_analysis_run import MainWindowAnalysisRunMixin


class MainWindowAnalysisVariantsMixin(MainWindowAnalysisRunMixin):
    def _active_dda_variant_ids(self) -> List[str]:
        return [
            variant_id
            for variant_id, checkbox in self.variant_checkboxes.items()
            if checkbox.isChecked()
        ]

    def _default_dda_variant_channel_names(self, dataset) -> List[str]:
        return self._preferred_channel_names(
            dataset,
            min(8, len(dataset.channel_names)),
        )

    def _default_dda_variant_pair_names(
        self, variant_id: str, dataset
    ) -> List[tuple[str, str]]:
        _ = variant_id
        _ = dataset
        return []

    def _reset_dda_variant_channel_selections(self, dataset=None) -> None:
        target_dataset = dataset or self.state.selected_dataset
        if target_dataset is None:
            self._dda_variant_channel_names = {
                variant_id: [] for variant_id in self.DDA_SINGLE_CHANNEL_VARIANTS
            }
            self._dda_variant_pair_names = {
                variant_id: [] for variant_id in self.DDA_PAIR_VARIANTS
            }
            self._populate_dda_variant_channel_lists()
            return
        default_names = self._default_dda_variant_channel_names(target_dataset)
        self._dda_variant_channel_names = {
            variant_id: (
                list(default_names)
                if (
                    variant_id == "ST"
                    and getattr(self, "variant_checkboxes", {}).get(variant_id)
                    and self.variant_checkboxes[variant_id].isChecked()
                )
                else []
            )
            for variant_id in self.DDA_SINGLE_CHANNEL_VARIANTS
        }
        self._dda_variant_pair_names = {
            variant_id: self._default_dda_variant_pair_names(variant_id, target_dataset)
            for variant_id in self.DDA_PAIR_VARIANTS
        }
        self._populate_dda_variant_channel_lists()

    def _selected_dda_variant_channel_names(self, variant_id: str) -> List[str]:
        if variant_id in self.DDA_PAIR_VARIANTS:
            return self._channels_from_pair_names(
                self._selected_dda_variant_pair_names(variant_id)
            )
        channel_list = getattr(self, "dda_variant_channel_lists", {}).get(variant_id)
        if channel_list is None:
            return list(self._dda_variant_channel_names.get(variant_id, []))
        names: List[str] = []
        for index in range(channel_list.count()):
            item = channel_list.item(index)
            if item.checkState() == Qt.Checked:
                names.append(str(item.data(Qt.UserRole)))
        self._dda_variant_channel_names[variant_id] = list(names)
        return names

    def _current_dda_variant_channel_payload(self) -> Dict[str, List[str]]:
        payload: Dict[str, List[str]] = {}
        for variant_id in self.DDA_VARIANT_ORDER:
            payload[variant_id] = self._selected_dda_variant_channel_names(variant_id)
        return payload

    def _current_dda_variant_pair_payload(self) -> Dict[str, List[List[str]]]:
        payload: Dict[str, List[List[str]]] = {}
        for variant_id in self.DDA_PAIR_VARIANTS:
            payload[variant_id] = [
                [left, right]
                for left, right in self._selected_dda_variant_pair_names(variant_id)
            ]
        return payload

    def _channels_from_pair_names(
        self,
        pair_names: List[tuple[str, str]],
    ) -> List[str]:
        ordered: List[str] = []
        seen: set[str] = set()
        for left, right in pair_names:
            for name in (left, right):
                if name in seen:
                    continue
                seen.add(name)
                ordered.append(name)
        return ordered

    def _sanitize_dda_variant_pair_names(
        self,
        variant_id: str,
        pair_names: List[tuple[str, str]],
        dataset,
    ) -> List[tuple[str, str]]:
        if dataset is None:
            return []
        index_lookup = {
            channel.name: index for index, channel in enumerate(dataset.channels)
        }
        cleaned: List[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for left_name, right_name in pair_names:
            if (
                left_name not in index_lookup
                or right_name not in index_lookup
                or left_name == right_name
            ):
                continue
            if variant_id == "CT":
                left_index = index_lookup[left_name]
                right_index = index_lookup[right_name]
                canonical = (
                    (left_name, right_name)
                    if left_index <= right_index
                    else (right_name, left_name)
                )
            else:
                canonical = (left_name, right_name)
            if canonical in seen:
                continue
            seen.add(canonical)
            cleaned.append(canonical)
        return cleaned

    def _legacy_pair_names_from_channel_names(
        self,
        variant_id: str,
        channel_names: List[str],
        dataset,
    ) -> List[tuple[str, str]]:
        if dataset is None:
            return []
        selected_indices = [
            dataset.channel_names.index(name)
            for name in channel_names
            if name in dataset.channel_names
        ]
        if variant_id == "CT":
            pairs = self._build_undirected_name_pairs(dataset, selected_indices)
        elif variant_id == "CD":
            pairs = self._build_directed_name_pairs(dataset, selected_indices)
        else:
            pairs = []
        return self._sanitize_dda_variant_pair_names(variant_id, pairs, dataset)

    def _apply_dda_variant_channel_payload(self, payload: object) -> None:
        if isinstance(payload, dict):
            dataset = self.state.selected_dataset
            dataset_channel_names = set(dataset.channel_names) if dataset else None
            for variant_id in self.DDA_SINGLE_CHANNEL_VARIANTS:
                raw_names = payload.get(variant_id)
                if not isinstance(raw_names, list):
                    continue
                normalized_names = [
                    str(name)
                    for name in raw_names
                    if isinstance(name, str)
                    and (
                        dataset_channel_names is None
                        or str(name) in dataset_channel_names
                    )
                ]
                self._dda_variant_channel_names[variant_id] = normalized_names
            for variant_id in self.DDA_PAIR_VARIANTS:
                raw_names = payload.get(variant_id)
                if not isinstance(raw_names, list):
                    continue
                normalized_names = [
                    str(name)
                    for name in raw_names
                    if isinstance(name, str)
                    and (
                        dataset_channel_names is None
                        or str(name) in dataset_channel_names
                    )
                ]
                if variant_id not in self._dda_variant_pair_names:
                    self._dda_variant_pair_names[variant_id] = []
                if normalized_names and not self._dda_variant_pair_names.get(
                    variant_id
                ):
                    self._dda_variant_pair_names[variant_id] = (
                        self._legacy_pair_names_from_channel_names(
                            variant_id,
                            normalized_names,
                            dataset,
                        )
                    )
        self._populate_dda_variant_channel_lists()

    def _apply_dda_variant_pair_payload(self, payload: object) -> None:
        dataset = self.state.selected_dataset
        if isinstance(payload, dict):
            for variant_id in self.DDA_PAIR_VARIANTS:
                raw_pairs = payload.get(variant_id)
                if not isinstance(raw_pairs, list):
                    continue
                parsed_pairs: List[tuple[str, str]] = []
                for raw_pair in raw_pairs:
                    if (
                        isinstance(raw_pair, (list, tuple))
                        and len(raw_pair) == 2
                        and all(isinstance(value, str) for value in raw_pair)
                    ):
                        parsed_pairs.append((str(raw_pair[0]), str(raw_pair[1])))
                self._dda_variant_pair_names[variant_id] = (
                    self._sanitize_dda_variant_pair_names(
                        variant_id,
                        parsed_pairs,
                        dataset,
                    )
                )
        self._populate_dda_variant_channel_lists()

    def _apply_dda_variant_channel_filter(self, variant_id: str) -> None:
        channel_list = getattr(self, "dda_variant_channel_lists", {}).get(variant_id)
        filter_edit = getattr(self, "dda_variant_channel_filter_edits", {}).get(
            variant_id
        )
        if channel_list is None:
            return
        query = filter_edit.text() if filter_edit is not None else ""
        apply_list_widget_filter(channel_list, query)

    def _set_dda_variant_channels_checked(
        self,
        variant_id: str,
        checked: bool,
    ) -> None:
        channel_list = getattr(self, "dda_variant_channel_lists", {}).get(variant_id)
        if channel_list is None:
            return
        set_check_state_for_list_items(
            channel_list,
            Qt.Checked if checked else Qt.Unchecked,
        )
        self._on_dda_variant_channel_list_changed(variant_id)

    def _apply_dda_variant_pair_filter(self, variant_id: str) -> None:
        pair_list = getattr(self, "dda_variant_pair_lists", {}).get(variant_id)
        filter_edit = getattr(self, "dda_variant_pair_filter_edits", {}).get(variant_id)
        if pair_list is None:
            return
        query = filter_edit.text() if filter_edit is not None else ""
        apply_list_widget_filter(pair_list, query)

    def _apply_dda_variant_pair_combo_filters(self, variant_id: str) -> None:
        dataset = self.state.selected_dataset
        source_combo = getattr(self, "dda_variant_pair_source_combos", {}).get(
            variant_id
        )
        target_combo = getattr(self, "dda_variant_pair_target_combos", {}).get(
            variant_id
        )
        if dataset is None or source_combo is None or target_combo is None:
            return
        previous_source_name = current_combo_box_value(source_combo)
        previous_target_name = current_combo_box_value(target_combo)
        source_filter_edit = getattr(
            self,
            "dda_variant_pair_source_filter_edits",
            {},
        ).get(variant_id)
        target_filter_edit = getattr(
            self,
            "dda_variant_pair_target_filter_edits",
            {},
        ).get(variant_id)
        source_names = filter_text_choices(
            dataset.channel_names,
            source_filter_edit.text() if source_filter_edit is not None else "",
        )
        target_names = filter_text_choices(
            dataset.channel_names,
            target_filter_edit.text() if target_filter_edit is not None else "",
        )
        with QSignalBlocker(source_combo):
            source_combo.clear()
            for channel_name in source_names:
                source_combo.addItem(channel_name, channel_name)
            source_combo.setEnabled(bool(source_names))
            if source_names:
                source_index = source_combo.findData(previous_source_name)
                source_combo.setCurrentIndex(source_index if source_index >= 0 else 0)
        with QSignalBlocker(target_combo):
            target_combo.clear()
            for channel_name in target_names:
                target_combo.addItem(channel_name, channel_name)
            target_combo.setEnabled(bool(target_names))
            if target_names:
                target_index = target_combo.findData(previous_target_name)
                target_combo.setCurrentIndex(target_index if target_index >= 0 else 0)
        self._update_dda_variant_pair_buttons(variant_id)

    def _populate_dda_variant_channel_lists(self) -> None:
        if not hasattr(self, "dda_variant_channel_sections"):
            return
        dataset = self.state.selected_dataset
        if dataset is None:
            for variant_id, channel_list in self.dda_variant_channel_lists.items():
                with QSignalBlocker(channel_list):
                    channel_list.clear()
                    channel_list.setEnabled(False)
            for variant_id, pair_list in self.dda_variant_pair_lists.items():
                with QSignalBlocker(pair_list):
                    pair_list.clear()
                    pair_list.setEnabled(False)
                source_combo = self.dda_variant_pair_source_combos.get(variant_id)
                target_combo = self.dda_variant_pair_target_combos.get(variant_id)
                if source_combo is not None:
                    source_combo.clear()
                    source_combo.setEnabled(False)
                if target_combo is not None:
                    target_combo.clear()
                    target_combo.setEnabled(False)
                summary = self.dda_variant_channel_summaries.get(variant_id)
                if summary is not None:
                    summary.setText("Open a dataset to configure channels.")
            self._update_dda_variant_selector_ui()
            return

        dataset_channel_names = set(dataset.channel_names)
        default_names = self._default_dda_variant_channel_names(dataset)
        for variant_id in self.DDA_SINGLE_CHANNEL_VARIANTS:
            channel_list = self.dda_variant_channel_lists.get(variant_id)
            if channel_list is None:
                continue
            checkbox = self.variant_checkboxes.get(variant_id)
            is_active = bool(checkbox and checkbox.isChecked())
            selected_names = [
                name
                for name in self._dda_variant_channel_names.get(variant_id, [])
                if name in dataset_channel_names
            ]
            if not selected_names and is_active:
                selected_names = list(default_names)
                self._dda_variant_channel_names[variant_id] = list(selected_names)
            elif not selected_names:
                self._dda_variant_channel_names[variant_id] = []
            selected_lookup = set(selected_names)
            with QSignalBlocker(channel_list):
                channel_list.clear()
                channel_list.setEnabled(True)
                for channel in dataset.channels:
                    item = QListWidgetItem(
                        f"{channel.name} · {channel.sample_rate_hz:.1f} Hz"
                    )
                    item.setData(Qt.UserRole, channel.name)
                    item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                    item.setCheckState(
                        Qt.Checked if channel.name in selected_lookup else Qt.Unchecked
                    )
                    channel_list.addItem(item)
            self._apply_dda_variant_channel_filter(variant_id)
            self._update_dda_variant_channel_summary(variant_id)
        for variant_id in self.DDA_PAIR_VARIANTS:
            pair_list = self.dda_variant_pair_lists.get(variant_id)
            source_combo = self.dda_variant_pair_source_combos.get(variant_id)
            target_combo = self.dda_variant_pair_target_combos.get(variant_id)
            if pair_list is None or source_combo is None or target_combo is None:
                continue
            selected_pairs = self._sanitize_dda_variant_pair_names(
                variant_id,
                self._dda_variant_pair_names.get(variant_id, []),
                dataset,
            )
            self._dda_variant_pair_names[variant_id] = list(selected_pairs)
            with QSignalBlocker(pair_list):
                pair_list.clear()
                pair_list.setEnabled(True)
                for left_name, right_name in selected_pairs:
                    item = QListWidgetItem(
                        self._format_dda_pair_label(variant_id, left_name, right_name)
                    )
                    item.setData(Qt.UserRole, (left_name, right_name))
                    pair_list.addItem(item)
            self._apply_dda_variant_pair_filter(variant_id)
            self._apply_dda_variant_pair_combo_filters(variant_id)
            self._update_dda_variant_channel_summary(variant_id)
            self._update_dda_variant_pair_buttons(variant_id)
        self._update_dda_variant_selector_ui()

    def _variant_selector_status_text(self, variant_id: Optional[str]) -> str:
        if not variant_id:
            return "Turn on a DDA variant to configure its dedicated selector."
        if variant_id == "CD":
            return "Editing CD directed pairs."
        if variant_id == "CT":
            return "Editing CT undirected pairs."
        return f"Editing {variant_id} channels."

    def _update_dda_variant_selector_ui(self) -> None:
        if not hasattr(self, "dda_variant_channel_sections"):
            return
        has_dataset = self.state.selected_dataset is not None
        active_variant_ids = [
            variant_id
            for variant_id in self.DDA_VARIANT_ORDER
            if bool(
                getattr(self, "variant_checkboxes", {}).get(variant_id)
                and self.variant_checkboxes[variant_id].isChecked()
            )
        ]
        current_variant_id = getattr(self, "_active_dda_selector_variant_id", None)
        if current_variant_id not in active_variant_ids:
            current_variant_id = active_variant_ids[0] if active_variant_ids else None
        selector_nav = getattr(self, "dda_variant_selector_nav", None)
        if selector_nav is not None:
            with QSignalBlocker(selector_nav):
                while selector_nav.count() > 0:
                    selector_nav.removeTab(0)
                for variant_id in active_variant_ids:
                    selector_nav.addTab(variant_id)
                    selector_nav.setTabToolTip(
                        selector_nav.count() - 1,
                        self._variant_selector_status_text(variant_id),
                    )
                if current_variant_id in active_variant_ids:
                    selector_nav.setCurrentIndex(
                        active_variant_ids.index(current_variant_id)
                    )
            selector_nav.setVisible(len(active_variant_ids) > 1)
        stack = getattr(self, "dda_variant_selector_stack", None)
        empty_state = getattr(self, "dda_variant_selector_empty", None)
        status_label = getattr(self, "dda_variant_selector_status", None)
        if empty_state is not None:
            empty_state.setVisible(not active_variant_ids)
        if stack is not None:
            stack.setVisible(bool(active_variant_ids))
        if status_label is not None:
            status_label.setText(self._variant_selector_status_text(current_variant_id))
        for variant_id, section in self.dda_variant_channel_sections.items():
            section.setEnabled(has_dataset)
            self._update_dda_variant_channel_summary(variant_id)
            if variant_id in self.DDA_PAIR_VARIANTS:
                self._update_dda_variant_pair_buttons(variant_id)
        self._set_active_dda_selector_variant(current_variant_id)

    def _set_active_dda_selector_variant(self, variant_id: Optional[str]) -> None:
        self._active_dda_selector_variant_id = variant_id
        stack = getattr(self, "dda_variant_selector_stack", None)
        page_indices = getattr(self, "_dda_variant_selector_page_indices", {})
        if stack is None or variant_id is None or variant_id not in page_indices:
            return
        stack.setCurrentIndex(page_indices[variant_id])

    def _on_dda_variant_selector_changed(self, index: int) -> None:
        if index < 0:
            return
        active_variant_ids = [
            variant_id
            for variant_id in self.DDA_VARIANT_ORDER
            if bool(
                getattr(self, "variant_checkboxes", {}).get(variant_id)
                and self.variant_checkboxes[variant_id].isChecked()
            )
        ]
        if 0 <= index < len(active_variant_ids):
            self._set_active_dda_selector_variant(active_variant_ids[index])
            status_label = getattr(self, "dda_variant_selector_status", None)
            if status_label is not None:
                status_label.setText(
                    self._variant_selector_status_text(active_variant_ids[index])
                )
            self._schedule_session_save()

    def _update_dda_variant_channel_summary(self, variant_id: str) -> None:
        summary = getattr(self, "dda_variant_channel_summaries", {}).get(variant_id)
        if summary is None:
            return
        dataset = self.state.selected_dataset
        if dataset is None:
            summary.setText("Open a dataset to configure channels.")
            return
        if variant_id in self.DDA_PAIR_VARIANTS:
            count = len(self._selected_dda_variant_pair_names(variant_id))
            if count == 0:
                label = "directed pairs" if variant_id == "CD" else "pairs"
                summary.setText(
                    f"No {label} selected for {variant_id}. Add at least one pair."
                )
                return
            noun = "pair" if count == 1 else "pairs"
            summary.setText(f"{count} {noun} selected for {variant_id}.")
            return
        count = len(self._selected_dda_variant_channel_names(variant_id))
        if count == 0:
            summary.setText(f"No channels selected for {variant_id}.")
            return
        noun = "channel" if count == 1 else "channels"
        summary.setText(f"{count} {noun} selected for {variant_id}.")

    def _format_dda_pair_label(
        self,
        variant_id: str,
        left_name: str,
        right_name: str,
    ) -> str:
        separator = " -> " if variant_id == "CD" else " <> "
        return f"{left_name}{separator}{right_name}"

    def _selected_dda_variant_pair_names(
        self,
        variant_id: str,
    ) -> List[tuple[str, str]]:
        pair_list = getattr(self, "dda_variant_pair_lists", {}).get(variant_id)
        if pair_list is None:
            return list(self._dda_variant_pair_names.get(variant_id, []))
        pairs: List[tuple[str, str]] = []
        for index in range(pair_list.count()):
            item = pair_list.item(index)
            raw_pair = item.data(Qt.UserRole)
            if (
                isinstance(raw_pair, (list, tuple))
                and len(raw_pair) == 2
                and all(isinstance(value, str) for value in raw_pair)
            ):
                pairs.append((str(raw_pair[0]), str(raw_pair[1])))
        dataset = self.state.selected_dataset
        self._dda_variant_pair_names[variant_id] = (
            self._sanitize_dda_variant_pair_names(
                variant_id,
                pairs,
                dataset,
            )
        )
        return list(self._dda_variant_pair_names[variant_id])

    def _update_dda_variant_pair_buttons(self, variant_id: str) -> None:
        pair_list = self.dda_variant_pair_lists.get(variant_id)
        add_button = self.dda_variant_pair_add_buttons.get(variant_id)
        remove_button = self.dda_variant_pair_remove_buttons.get(variant_id)
        clear_button = self.dda_variant_pair_clear_buttons.get(variant_id)
        dataset = self.state.selected_dataset
        has_dataset = dataset is not None
        has_pairs = bool(self._selected_dda_variant_pair_names(variant_id))
        has_selection = bool(pair_list and pair_list.selectedItems())
        source_combo = self.dda_variant_pair_source_combos.get(variant_id)
        target_combo = self.dda_variant_pair_target_combos.get(variant_id)
        has_channel_choices = bool(
            source_combo
            and target_combo
            and source_combo.count() > 0
            and target_combo.count() > 0
        )
        if add_button is not None:
            add_button.setEnabled(has_dataset and has_channel_choices)
        if remove_button is not None:
            remove_button.setEnabled(has_dataset and has_selection)
        if clear_button is not None:
            clear_button.setEnabled(has_dataset and has_pairs)

    def _on_dda_variant_checkbox_toggled(
        self,
        variant_id: str,
        checked: bool,
    ) -> None:
        dataset = self.state.selected_dataset
        if checked:
            self._active_dda_selector_variant_id = variant_id
        if (
            checked
            and dataset is not None
            and variant_id in self.DDA_SINGLE_CHANNEL_VARIANTS
            and not self._selected_dda_variant_channel_names(variant_id)
        ):
            seed_names = (
                list(self._selected_dda_variant_channel_names("ST"))
                if variant_id != "ST"
                else []
            )
            self._dda_variant_channel_names[variant_id] = (
                seed_names or self._default_dda_variant_channel_names(dataset)
            )
            self._populate_dda_variant_channel_lists()
            self._schedule_session_save()
            return
        self._update_dda_variant_selector_ui()
        self._schedule_session_save()

    def _on_dda_variant_channel_list_changed(self, variant_id: str) -> None:
        self._dda_variant_channel_names[variant_id] = (
            self._selected_dda_variant_channel_names(variant_id)
        )
        self._update_dda_variant_channel_summary(variant_id)
        self._schedule_session_save()

    def _on_dda_variant_pair_add_requested(self, variant_id: str) -> None:
        dataset = self.state.selected_dataset
        source_combo = self.dda_variant_pair_source_combos.get(variant_id)
        target_combo = self.dda_variant_pair_target_combos.get(variant_id)
        if dataset is None or source_combo is None or target_combo is None:
            return
        left_name = current_combo_box_value(source_combo)
        right_name = current_combo_box_value(target_combo)
        if not left_name or not right_name:
            self._show_error("Choose two channels before adding a pair.")
            return
        available_channel_names = set(dataset.channel_names)
        if (
            left_name not in available_channel_names
            or right_name not in available_channel_names
        ):
            self._show_error(
                "Choose channels from the dataset list before adding a pair."
            )
            return
        if left_name == right_name:
            self._show_error("A DDA pair must use two different channels.")
            return
        updated_pairs = list(self._selected_dda_variant_pair_names(variant_id))
        updated_pairs.append((left_name, right_name))
        sanitized_pairs = self._sanitize_dda_variant_pair_names(
            variant_id,
            updated_pairs,
            dataset,
        )
        if len(sanitized_pairs) == len(
            self._dda_variant_pair_names.get(variant_id, [])
        ):
            self._show_error("That pair is already selected.")
            return
        self._dda_variant_pair_names[variant_id] = sanitized_pairs
        self._populate_dda_variant_channel_lists()
        self._schedule_session_save()

    def _on_dda_variant_pair_remove_requested(self, variant_id: str) -> None:
        pair_list = self.dda_variant_pair_lists.get(variant_id)
        dataset = self.state.selected_dataset
        if pair_list is None or dataset is None:
            return
        selected_rows = sorted(
            {pair_list.row(item) for item in pair_list.selectedItems()},
            reverse=True,
        )
        if not selected_rows:
            return
        current_pairs = list(self._selected_dda_variant_pair_names(variant_id))
        for row in selected_rows:
            if 0 <= row < len(current_pairs):
                current_pairs.pop(row)
        self._dda_variant_pair_names[variant_id] = (
            self._sanitize_dda_variant_pair_names(
                variant_id,
                current_pairs,
                dataset,
            )
        )
        self._populate_dda_variant_channel_lists()
        self._schedule_session_save()

    def _on_dda_variant_pair_clear_requested(self, variant_id: str) -> None:
        self._dda_variant_pair_names[variant_id] = []
        self._populate_dda_variant_channel_lists()
        self._schedule_session_save()

    def _selected_dda_variant_channel_names_map(
        self,
        variant_ids: List[str],
    ) -> Dict[str, List[str]]:
        return {
            variant_id: self._selected_dda_variant_channel_names(variant_id)
            for variant_id in variant_ids
        }

    def _selected_dda_variant_channel_indices_map(
        self,
        dataset,
        variant_channel_names: Dict[str, List[str]],
    ) -> Dict[str, List[int]]:
        resolved: Dict[str, List[int]] = {}
        for variant_id, channel_names in variant_channel_names.items():
            resolved[variant_id] = [
                dataset.channel_names.index(name)
                for name in channel_names
                if name in dataset.channel_names
            ]
        return resolved

    def _selected_dda_variant_pair_names_map(
        self,
        variant_ids: List[str],
    ) -> Dict[str, List[tuple[str, str]]]:
        return {
            variant_id: self._selected_dda_variant_pair_names(variant_id)
            for variant_id in variant_ids
            if variant_id in self.DDA_PAIR_VARIANTS
        }

    def _selected_dda_variant_pair_indices_map(
        self,
        dataset,
        variant_pair_names: Dict[str, List[tuple[str, str]]],
    ) -> Dict[str, List[tuple[int, int]]]:
        resolved: Dict[str, List[tuple[int, int]]] = {}
        for variant_id, pair_names in variant_pair_names.items():
            variant_pairs: List[tuple[int, int]] = []
            for left_name, right_name in pair_names:
                if (
                    left_name in dataset.channel_names
                    and right_name in dataset.channel_names
                ):
                    variant_pairs.append(
                        (
                            dataset.channel_names.index(left_name),
                            dataset.channel_names.index(right_name),
                        )
                    )
            resolved[variant_id] = variant_pairs
        return resolved

    def _union_channel_selection(
        self,
        dataset,
        variant_channel_indices: Dict[str, List[int]],
        variant_pair_indices: Dict[str, List[tuple[int, int]]],
    ) -> tuple[List[int], List[str]]:
        ordered_indices: List[int] = []
        seen_indices: set[int] = set()
        for variant_id in self.DDA_VARIANT_ORDER:
            for index in variant_channel_indices.get(variant_id, []):
                if index in seen_indices:
                    continue
                seen_indices.add(index)
                ordered_indices.append(index)
            for left_index, right_index in variant_pair_indices.get(variant_id, []):
                for index in (left_index, right_index):
                    if index in seen_indices:
                        continue
                    seen_indices.add(index)
                    ordered_indices.append(index)
        return (
            ordered_indices,
            [
                dataset.channel_names[index]
                for index in ordered_indices
                if 0 <= index < len(dataset.channel_names)
            ],
        )

    def _format_variant_channel_summary(
        self,
        variant_channel_names: Dict[str, List[str]],
        variant_pair_names: Dict[str, List[tuple[str, str]]],
    ) -> str:
        parts: List[str] = []
        for variant_id in self.DDA_VARIANT_ORDER:
            if variant_id in self.DDA_PAIR_VARIANTS:
                pair_names = variant_pair_names.get(variant_id)
                if not pair_names:
                    continue
                parts.append(
                    f"{variant_id}: "
                    + ", ".join(
                        self._format_dda_pair_label(variant_id, left, right)
                        for left, right in pair_names
                    )
                )
            else:
                channel_names = variant_channel_names.get(variant_id)
                if not channel_names:
                    continue
                parts.append(f"{variant_id}: {', '.join(channel_names)}")
        return " | ".join(parts) if parts else "—"

    def _build_undirected_name_pairs(
        self,
        dataset,
        selected_indices: List[int],
    ) -> List[tuple[str, str]]:
        return [
            (dataset.channel_names[left], dataset.channel_names[right])
            for left_index in range(len(selected_indices))
            for right_index in range(left_index + 1, len(selected_indices))
            for left, right in [
                (selected_indices[left_index], selected_indices[right_index])
            ]
        ]

    def _build_directed_name_pairs(
        self,
        dataset,
        selected_indices: List[int],
    ) -> List[tuple[str, str]]:
        return [
            (dataset.channel_names[left], dataset.channel_names[right])
            for left in selected_indices
            for right in selected_indices
            if left != right
        ]
