from __future__ import annotations

from itertools import combinations_with_replacement
import math
from pathlib import Path
import time
from typing import Dict, List, Optional

from PySide6.QtCore import QSignalBlocker, Qt
from PySide6.QtWidgets import (
    QFrame,
    QLabel,
    QListWidgetItem,
    QMenu,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QWidgetAction,
)

from ..backend.api import build_network_motif_data
from ..domain.models import (
    DdaReproductionConfig,
    DdaResult,
    DdaRunDetails,
    DdaRunProgress,
    DdaVariantResult,
    IcaResult,
    NetworkMotifData,
)
from .main_window_support import (
    _build_connectivity_metrics,
    _build_variant_comparisons,
    _human_bytes,
)


class MainWindowAnalysisMixin:
    DDA_VARIANT_ORDER = ("ST", "SY", "DE", "CT", "CD")
    DDA_SINGLE_CHANNEL_VARIANTS = ("ST", "SY", "DE")
    DDA_PAIR_VARIANTS = ("CT", "CD")
    COMPARE_VIEW_MODE_ORDER = ("summary", "heatmaps", "lines", "stats")
    DDA_DEFAULT_DELAYS = (7, 10)
    DDA_DEFAULT_MODEL_TERMS = (1, 2, 10)
    DDA_DEFAULT_MODEL_DIMENSION = 4
    DDA_DEFAULT_POLYNOMIAL_ORDER = 4
    DDA_DEFAULT_NR_TAU = 2

    def _required_dda_delay_count(self, raw_nr_tau: Optional[object] = None) -> int:
        if raw_nr_tau is None:
            nr_tau_spin = getattr(self, "dda_nr_tau_spin", None)
            raw_nr_tau = (
                nr_tau_spin.value()
                if nr_tau_spin is not None
                else self.DDA_DEFAULT_NR_TAU
            )
        try:
            required_count = int(raw_nr_tau)
        except (TypeError, ValueError):
            required_count = self.DDA_DEFAULT_NR_TAU
        return max(1, required_count)

    def _parse_dda_delay_values(self, raw_text: Optional[str] = None) -> List[int]:
        text = self.delays_edit.text() if raw_text is None else raw_text
        delays: List[int] = []
        invalid_tokens: List[str] = []
        for raw_token in str(text).split(","):
            token = raw_token.strip()
            if not token:
                continue
            try:
                delays.append(int(token))
            except ValueError:
                invalid_tokens.append(token)
        if invalid_tokens:
            raise ValueError(
                "Invalid delay values: " + ", ".join(invalid_tokens) + "."
            )
        if not delays:
            raise ValueError("Provide at least one DDA delay value.")
        negative_delays = [str(delay) for delay in delays if delay < 0]
        if negative_delays:
            raise ValueError(
                "Delay values must be non-negative because negative delays imply lookahead: "
                + ", ".join(negative_delays)
                + "."
            )
        required_count = self._required_dda_delay_count()
        if len(delays) < required_count:
            raise ValueError(
                f"Provide at least {required_count} DDA delay values because Model delays is set to {required_count}."
            )
        return delays

    def _safe_dda_delay_values(self) -> List[int]:
        try:
            return self._parse_dda_delay_values()
        except ValueError:
            return list(self.DDA_DEFAULT_DELAYS)

    def _generate_dda_monomials(
        self,
        num_delays: int,
        polynomial_order: int,
    ) -> List[tuple[int, ...]]:
        if num_delays < 1 or polynomial_order < 1:
            return []
        monomials: List[tuple[int, ...]] = []
        for delay_index in range(1, num_delays + 1):
            monomials.append((0, delay_index))
        choices = list(range(1, num_delays + 1))
        for degree in range(2, polynomial_order + 1):
            monomials.extend(tuple(combo) for combo in combinations_with_replacement(choices, degree))
        return monomials

    def _sanitize_dda_model_terms(
        self,
        terms: Optional[List[int]],
        *,
        num_delays: int,
        polynomial_order: int,
    ) -> List[int]:
        total_terms = len(
            self._generate_dda_monomials(num_delays, polynomial_order)
        )
        ordered: List[int] = []
        seen: set[int] = set()
        for raw_term in terms or []:
            try:
                term = int(raw_term)
            except (TypeError, ValueError):
                continue
            if term < 1 or term > total_terms or term in seen:
                continue
            seen.add(term)
            ordered.append(term)
        return ordered

    def _current_dda_model_terms(self) -> List[int]:
        term_list = getattr(self, "dda_model_terms_list", None)
        if term_list is None:
            return list(getattr(self, "_dda_model_terms", self.DDA_DEFAULT_MODEL_TERMS))
        selected_terms: List[int] = []
        for index in range(term_list.count()):
            item = term_list.item(index)
            if item.checkState() != Qt.Checked:
                continue
            raw_value = item.data(Qt.UserRole)
            try:
                selected_terms.append(int(raw_value))
            except (TypeError, ValueError):
                continue
        self._dda_model_terms = list(selected_terms)
        return list(selected_terms)

    def _current_dda_model_parameters(self) -> tuple[List[int], int, int, int]:
        expert_mode = bool(self.state.expert_mode)
        if not expert_mode:
            return (
                list(self.DDA_DEFAULT_MODEL_TERMS),
                self.DDA_DEFAULT_MODEL_DIMENSION,
                self.DDA_DEFAULT_POLYNOMIAL_ORDER,
                self.DDA_DEFAULT_NR_TAU,
            )
        model_dimension = self.dda_model_dimension_spin.value()
        polynomial_order = self.dda_polynomial_order_spin.value()
        nr_tau = self.dda_nr_tau_spin.value()
        model_terms = self._sanitize_dda_model_terms(
            self._current_dda_model_terms(),
            num_delays=nr_tau,
            polynomial_order=polynomial_order,
        )
        if not model_terms:
            raise ValueError("Select at least one MODEL term before running DDA.")
        return model_terms, model_dimension, polynomial_order, nr_tau

    def _dda_monomial_label(
        self,
        monomial: tuple[int, ...],
        *,
        delays: Optional[List[int]] = None,
        rich: bool = False,
    ) -> str:
        delay_values = list(delays or [])
        if len(monomial) == 2 and monomial[0] == 0:
            delay_index = monomial[1]
            if delay_index <= len(delay_values):
                base = self._format_dda_delay_term_label(delay_values[delay_index - 1])
            elif rich:
                base = f"x(t - &tau;<sub>{delay_index}</sub>)"
            else:
                base = f"x(t - tau_{delay_index})"
            return base

        counts: Dict[int, int] = {}
        for delay_index in monomial:
            counts[delay_index] = counts.get(delay_index, 0) + 1
        terms: List[str] = []
        for delay_index in sorted(counts):
            if delay_index <= len(delay_values):
                base = self._format_dda_delay_term_label(delay_values[delay_index - 1])
            elif rich:
                base = f"x(t - &tau;<sub>{delay_index}</sub>)"
            else:
                base = f"x(t - tau_{delay_index})"
            power = counts[delay_index]
            if power > 1:
                if rich:
                    terms.append(f"{base}<sup>{power}</sup>")
                else:
                    terms.append(f"{base}^{power}")
            else:
                terms.append(base)
        separator = " " if rich else " * "
        return separator.join(terms)

    def _dda_monomial_latex(
        self,
        monomial: tuple[int, ...],
        *,
        delays: Optional[List[int]] = None,
    ) -> str:
        delay_values = list(delays or [])
        if len(monomial) == 2 and monomial[0] == 0:
            delay_index = monomial[1]
            if delay_index <= len(delay_values):
                return self._format_dda_delay_term_latex(delay_values[delay_index - 1])
            return rf"x\left(t - \tau_{{{delay_index}}}\right)"

        counts: Dict[int, int] = {}
        for delay_index in monomial:
            counts[delay_index] = counts.get(delay_index, 0) + 1
        terms: List[str] = []
        for delay_index in sorted(counts):
            if delay_index <= len(delay_values):
                base = self._format_dda_delay_term_latex(delay_values[delay_index - 1])
            else:
                base = rf"x\left(t - \tau_{{{delay_index}}}\right)"
            power = counts[delay_index]
            if power > 1:
                terms.append(rf"{base}^{{{power}}}")
            else:
                terms.append(base)
        return r"\,".join(terms)

    def _format_dda_delay_term_label(self, delay_value: int | float) -> str:
        magnitude = f"{abs(float(delay_value)):.6g}"
        operator = "-" if float(delay_value) >= 0 else "+"
        return f"x(t {operator} {magnitude})"

    def _format_dda_delay_term_latex(self, delay_value: int | float) -> str:
        magnitude = f"{abs(float(delay_value)):.6g}"
        operator = "-" if float(delay_value) >= 0 else "+"
        return rf"x\left(t {operator} {magnitude}\right)"

    def _build_dda_model_equation_latex(
        self,
        *,
        model_terms: List[int],
        num_delays: int,
        polynomial_order: int,
        delays: Optional[List[int]] = None,
    ) -> str:
        monomials = self._generate_dda_monomials(num_delays, polynomial_order)
        rendered_terms: List[str] = []
        for coefficient_index, term_index in enumerate(model_terms, start=1):
            monomial_index = term_index - 1
            if monomial_index < 0 or monomial_index >= len(monomials):
                continue
            rendered_terms.append(
                rf"a_{{{coefficient_index}}}\,{self._dda_monomial_latex(monomials[monomial_index], delays=delays)}"
            )
        if not rendered_terms:
            return ""
        return r"\dot{x} = " + r" + ".join(rendered_terms)

    def _build_dda_model_equation_text(
        self,
        *,
        model_terms: List[int],
        num_delays: int,
        polynomial_order: int,
        delays: Optional[List[int]] = None,
    ) -> str:
        monomials = self._generate_dda_monomials(num_delays, polynomial_order)
        rendered_terms: List[str] = []
        for coefficient_index, term_index in enumerate(model_terms, start=1):
            monomial_index = term_index - 1
            if monomial_index < 0 or monomial_index >= len(monomials):
                continue
            rendered_terms.append(
                f"a{coefficient_index} {self._dda_monomial_label(monomials[monomial_index], delays=delays)}"
            )
        if not rendered_terms:
            return "No MODEL terms selected."
        return "dx/dt = " + " + ".join(rendered_terms)

    def _refresh_dda_expert_mode_ui(self) -> None:
        expert_mode = bool(self.state.expert_mode)
        if hasattr(self, "dda_expert_panel"):
            self.dda_expert_panel.setVisible(expert_mode)
        if hasattr(self, "dda_expert_mode_status"):
            self.dda_expert_mode_status.setText(
                "Expert controls active"
                if expert_mode
                else "Standard EEG preset active"
            )
        delays = self._safe_dda_delay_values() if expert_mode else list(self.DDA_DEFAULT_DELAYS)
        if expert_mode:
            summary_text = (
                "Expert mode is active. The selected delays and MODEL encoding below will be sent directly to the DDA backend."
            )
            try:
                model_terms, _model_dimension, polynomial_order, nr_tau = (
                    self._current_dda_model_parameters()
                )
            except ValueError:
                model_terms = self._sanitize_dda_model_terms(
                    self._current_dda_model_terms(),
                    num_delays=self.dda_nr_tau_spin.value(),
                    polynomial_order=self.dda_polynomial_order_spin.value(),
                )
                polynomial_order = self.dda_polynomial_order_spin.value()
                nr_tau = self.dda_nr_tau_spin.value()
        else:
            summary_text = (
                "Standard mode matches the archived DDALAB EEG preset: delays [7, 10], MODEL terms [1, 2, 10], dm=4, order=4, nr_tau=2."
            )
            model_terms = list(self.DDA_DEFAULT_MODEL_TERMS)
            polynomial_order = self.DDA_DEFAULT_POLYNOMIAL_ORDER
            nr_tau = self.DDA_DEFAULT_NR_TAU
        if hasattr(self, "dda_expert_summary_label"):
            self.dda_expert_summary_label.setText(summary_text)
        latex_expression = self._build_dda_model_equation_latex(
            model_terms=model_terms,
            num_delays=nr_tau,
            polynomial_order=polynomial_order,
            delays=delays,
        )
        fallback_text = self._build_dda_model_equation_text(
            model_terms=model_terms,
            num_delays=nr_tau,
            polynomial_order=polynomial_order,
            delays=delays,
        )
        if hasattr(self, "dda_expert_summary_equation"):
            self.dda_expert_summary_equation.set_math_expression(
                latex_expression,
                fallback_text=fallback_text,
            )
        if hasattr(self, "dda_model_preview_label"):
            self.dda_model_preview_label.set_math_expression(
                latex_expression,
                fallback_text=fallback_text,
            )
        if hasattr(self, "dda_model_term_summary"):
            total_terms = len(self._generate_dda_monomials(nr_tau, polynomial_order))
            selected_count = len(model_terms)
            note = (
                f" Selected {selected_count} of {total_terms} monomials."
                if total_terms > 0
                else " No monomials are available for the current model space."
            )
            if expert_mode and len(delays) < nr_tau:
                note += (
                    f" The model references {nr_tau} delay slots, but only {len(delays)} concrete delays are defined."
                )
            self.dda_model_term_summary.setText(note.strip())

    def _refresh_dda_model_term_list(self) -> None:
        if not hasattr(self, "dda_model_terms_list"):
            return
        num_delays = self.dda_nr_tau_spin.value()
        polynomial_order = self.dda_polynomial_order_spin.value()
        monomials = self._generate_dda_monomials(num_delays, polynomial_order)
        current_terms = self._sanitize_dda_model_terms(
            list(getattr(self, "_dda_model_terms", self.DDA_DEFAULT_MODEL_TERMS)),
            num_delays=num_delays,
            polynomial_order=polynomial_order,
        )
        if not current_terms and monomials:
            current_terms = self._sanitize_dda_model_terms(
                list(self.DDA_DEFAULT_MODEL_TERMS),
                num_delays=num_delays,
                polynomial_order=polynomial_order,
            )
        if not current_terms and monomials:
            current_terms = [1]
        self._dda_model_terms = list(current_terms)
        selected_lookup = set(current_terms)
        preview_delays = self._safe_dda_delay_values()
        with QSignalBlocker(self.dda_model_terms_list):
            self.dda_model_terms_list.clear()
            for index, monomial in enumerate(monomials, start=1):
                item = QListWidgetItem(
                    f"{index}. {self._dda_monomial_label(monomial, delays=preview_delays)}"
                )
                item.setData(Qt.UserRole, index)
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                item.setCheckState(Qt.Checked if index in selected_lookup else Qt.Unchecked)
                self.dda_model_terms_list.addItem(item)
        self._refresh_dda_expert_mode_ui()

    def _apply_dda_model_preset(
        self,
        preset_id: str,
        *,
        schedule_save: bool = True,
    ) -> None:
        num_delays = self.dda_nr_tau_spin.value()
        polynomial_order = self.dda_polynomial_order_spin.value()
        monomials = self._generate_dda_monomials(num_delays, polynomial_order)
        if preset_id == "eeg-standard":
            selected_terms = self._sanitize_dda_model_terms(
                list(self.DDA_DEFAULT_MODEL_TERMS),
                num_delays=num_delays,
                polynomial_order=polynomial_order,
            )
        else:
            selected_terms = []
            for index, monomial in enumerate(monomials, start=1):
                degree = 1 if len(monomial) == 2 and monomial[0] == 0 else len(monomial)
                is_linear = degree == 1
                is_pure = len(set(monomial)) == 1 if not is_linear else False
                if preset_id == "linear-only" and is_linear:
                    selected_terms.append(index)
                elif preset_id == "quadratic-diagonal" and (
                    is_linear or (degree == 2 and is_pure)
                ):
                    selected_terms.append(index)
                elif preset_id == "full-quadratic" and degree <= 2:
                    selected_terms.append(index)
                elif preset_id == "symmetric" and (is_linear or is_pure):
                    selected_terms.append(index)
        self._dda_model_terms = list(selected_terms)
        self._refresh_dda_model_term_list()
        if schedule_save:
            self._schedule_session_save()

    def _apply_selected_dda_model_preset(self) -> None:
        preset_id = str(self.dda_model_preset_combo.currentData() or "eeg-standard")
        self._apply_dda_model_preset(preset_id)

    def _reset_dda_model_to_default(self) -> None:
        with QSignalBlocker(self.dda_model_dimension_spin):
            self.dda_model_dimension_spin.setValue(self.DDA_DEFAULT_MODEL_DIMENSION)
        with QSignalBlocker(self.dda_polynomial_order_spin):
            self.dda_polynomial_order_spin.setValue(self.DDA_DEFAULT_POLYNOMIAL_ORDER)
        with QSignalBlocker(self.dda_nr_tau_spin):
            self.dda_nr_tau_spin.setValue(self.DDA_DEFAULT_NR_TAU)
        with QSignalBlocker(self.delays_edit):
            self.delays_edit.setText(",".join(str(delay) for delay in self.DDA_DEFAULT_DELAYS))
        preset_index = self.dda_model_preset_combo.findData("eeg-standard")
        if preset_index >= 0:
            with QSignalBlocker(self.dda_model_preset_combo):
                self.dda_model_preset_combo.setCurrentIndex(preset_index)
        self._dda_model_terms = list(self.DDA_DEFAULT_MODEL_TERMS)
        self._refresh_dda_model_term_list()
        self._schedule_session_save()

    def _apply_expert_mode(self, enabled: object, *, schedule_save: bool = True) -> None:
        normalized = bool(enabled)
        self.state.expert_mode = normalized
        if hasattr(self, "dda_expert_mode_checkbox") and self.dda_expert_mode_checkbox.isChecked() != normalized:
            with QSignalBlocker(self.dda_expert_mode_checkbox):
                self.dda_expert_mode_checkbox.setChecked(normalized)
        if (
            hasattr(self, "settings_expert_mode_checkbox")
            and self.settings_expert_mode_checkbox.isChecked() != normalized
        ):
            with QSignalBlocker(self.settings_expert_mode_checkbox):
                self.settings_expert_mode_checkbox.setChecked(normalized)
        self._refresh_dda_expert_mode_ui()
        self._refresh_settings_overview()
        if schedule_save:
            self._schedule_session_save()

    def _on_expert_mode_toggled(self, checked: bool) -> None:
        self._apply_expert_mode(checked)

    def _on_dda_expert_controls_changed(self, *_args) -> None:
        self._refresh_dda_expert_mode_ui()
        self._schedule_session_save()

    def _on_dda_model_space_changed(self, *_args) -> None:
        self._refresh_dda_model_term_list()
        self._schedule_session_save()

    def _on_dda_model_terms_changed(self, *_args) -> None:
        self._current_dda_model_terms()
        self._refresh_dda_expert_mode_ui()
        self._schedule_session_save()

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

    def _default_dda_variant_pair_names(self, variant_id: str, dataset) -> List[tuple[str, str]]:
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
                if normalized_names and not self._dda_variant_pair_names.get(variant_id):
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
                        Qt.Checked
                        if channel.name in selected_lookup
                        else Qt.Unchecked
                    )
                    channel_list.addItem(item)
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
            with QSignalBlocker(source_combo):
                source_combo.clear()
                for channel_name in dataset.channel_names:
                    source_combo.addItem(channel_name, channel_name)
                source_combo.setEnabled(True)
            with QSignalBlocker(target_combo):
                target_combo.clear()
                for channel_name in dataset.channel_names:
                    target_combo.addItem(channel_name, channel_name)
                target_combo.setEnabled(True)
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
                    selector_nav.setCurrentIndex(active_variant_ids.index(current_variant_id))
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
        if (
            stack is None
            or variant_id is None
            or variant_id not in page_indices
        ):
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
        self._dda_variant_pair_names[variant_id] = self._sanitize_dda_variant_pair_names(
            variant_id,
            pairs,
            dataset,
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
        if add_button is not None:
            add_button.setEnabled(has_dataset)
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
        left_name = str(source_combo.currentData() or source_combo.currentText()).strip()
        right_name = str(target_combo.currentData() or target_combo.currentText()).strip()
        if not left_name or not right_name:
            self._show_error("Choose two channels before adding a pair.")
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
        if len(sanitized_pairs) == len(self._dda_variant_pair_names.get(variant_id, [])):
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
        self._dda_variant_pair_names[variant_id] = self._sanitize_dda_variant_pair_names(
            variant_id,
            current_pairs,
            dataset,
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
            for left, right in [(selected_indices[left_index], selected_indices[right_index])]
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

    def _set_dda_running_state(
        self,
        running: bool,
        *,
        dataset_name: Optional[str] = None,
        variant_ids: Optional[List[str]] = None,
        details: Optional[DdaRunDetails] = None,
    ) -> None:
        self.state.dda_run_in_progress = running
        self.state.dda_run_file_name = dataset_name if running else None
        self.state.dda_run_variant_ids = list(variant_ids or []) if running else []
        self.state.dda_run_details = details if running else None
        self.state.dda_run_progress = None
        self._dda_run_animation_tick = 0
        self._dda_run_started_at = time.monotonic() if running else None
        self._dda_last_progress_ui_refresh_monotonic = 0.0
        self._dda_last_progress_stage_signature = None
        if running:
            self.dda_activity_timer.start()
            if hasattr(self, "dda_diagnostics"):
                self.dda_diagnostics.setPlainText(
                    "Running DDA… live progress is shown in the activity panel."
                )
            if hasattr(self, "result_summary"):
                self.result_summary.setPlainText(
                    "DDA is running…\n\nLive progress is shown in the activity panel."
                )
        else:
            self.dda_activity_timer.stop()
        self._refresh_dda_running_ui()

    def _update_dda_run_progress(self, payload: object) -> None:
        progress = DdaRunProgress.from_json(payload)
        if progress is None:
            return
        self.state.dda_run_progress = progress
        if not self.state.dda_run_in_progress:
            return
        now = time.monotonic()
        stage_signature = (
            progress.group_label,
            progress.stage_id,
        )
        should_refresh = (
            progress.step_index <= 1
            or progress.step_index >= progress.total_steps
            or stage_signature != self._dda_last_progress_stage_signature
            or now - self._dda_last_progress_ui_refresh_monotonic >= 0.35
        )
        if not should_refresh:
            return
        self._dda_last_progress_ui_refresh_monotonic = now
        self._dda_last_progress_stage_signature = stage_signature
        self._refresh_dda_running_ui()

    def _format_dda_progress_lines(self) -> tuple[str, str]:
        progress = self.state.dda_run_progress
        if progress is None:
            return ("", "")
        percent = (
            100.0 * progress.step_index / progress.total_steps
            if progress.total_steps > 0
            else 0.0
        )
        group_prefix = f"{progress.group_label} • " if progress.group_label else ""
        stage_line = (
            f"{percent:.1f}% • {group_prefix}{progress.stage_label or 'Running DDA'}"
        )
        detail_parts: List[str] = []
        if progress.window_index > 0 and progress.total_windows > 0:
            detail_parts.append(
                f"window {progress.window_index}/{progress.total_windows}"
            )
        if progress.item_index > 0 and progress.total_items > 0:
            item_kind = progress.item_kind or "item"
            detail_parts.append(
                f"{item_kind} {progress.item_index}/{progress.total_items}"
            )
        if progress.item_label:
            detail_parts.append(progress.item_label)
        if progress.step_index > 0 and progress.total_steps > 0:
            detail_parts.append(f"step {progress.step_index}/{progress.total_steps}")
        return stage_line, " • ".join(detail_parts)

    def _refresh_dda_running_ui(self) -> None:
        if not hasattr(self, "dda_activity_frame"):
            return
        is_running = self.state.dda_run_in_progress
        self.run_button.setEnabled(not is_running)
        self.run_dda_from_page_button.setEnabled(not is_running)
        self.dda_activity_progress.set_running(is_running)
        self.dda_global_progress.set_running(is_running)
        self.dda_activity_frame.setVisible(is_running)
        self.dda_global_activity.setVisible(is_running)
        if not is_running:
            self.dda_activity_label.clear()
            self.dda_activity_detail_label.clear()
            self.dda_activity_progress_bar.reset()
            self.dda_activity_progress_bar.setRange(0, 1)
            self.dda_activity_progress_bar.setValue(0)
            self.dda_global_label.clear()
            return
        self._dda_run_animation_tick += 1
        dots = "." * ((self._dda_run_animation_tick % 3) + 1)
        elapsed_seconds = (
            int(time.monotonic() - self._dda_run_started_at)
            if self._dda_run_started_at is not None
            else 0
        )
        file_name = self.state.dda_run_file_name or "dataset"
        variants = ", ".join(self.state.dda_run_variant_ids) or "DDA"
        headline = f"Running DDA on {file_name} ({variants})"
        progress_headline, progress_detail = self._format_dda_progress_lines()
        subline = (
            f"{progress_headline}\n{progress_detail}\nElapsed: {elapsed_seconds}s"
            if progress_headline
            else f"Worker is active asynchronously. Elapsed: {elapsed_seconds}s{dots}"
        )
        self.dda_activity_label.setText(f"{headline}\n{subline}")
        self.dda_activity_detail_label.setText(progress_detail)
        self.dda_global_label.setText(
            (
                f"DDA {progress_headline} • {file_name}"
                if progress_headline
                else f"DDA running • {file_name} • {elapsed_seconds}s{dots}"
            )
        )
        progress = self.state.dda_run_progress
        if progress is not None and progress.total_steps > 0:
            self.dda_activity_progress_bar.setRange(0, progress.total_steps)
            self.dda_activity_progress_bar.setValue(
                min(progress.step_index, progress.total_steps)
            )
            self.dda_activity_progress_bar.setFormat(
                f"%p%  ({min(progress.step_index, progress.total_steps)}/{progress.total_steps})"
            )
        else:
            self.dda_activity_progress_bar.setRange(0, 0)
        detail_hint = "Click for run details"
        self.dda_activity_label.setToolTip(detail_hint)
        self.dda_global_label.setToolTip(detail_hint)

    def _show_dda_run_details_popover(self, anchor: QWidget) -> None:
        if not self.state.dda_run_in_progress or self.state.dda_run_details is None:
            return
        if self._dda_run_details_menu is not None:
            self._dda_run_details_menu.close()
        menu = QMenu(self)
        menu.setObjectName("dda-run-details-popover")
        container = QFrame(menu)
        layout = QVBoxLayout(container)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(8)

        title = QLabel("Active DDA Execution")
        title.setProperty("title", True)
        title.setStyleSheet("font-size: 15px;")
        layout.addWidget(title)

        details_label = QLabel(self._format_dda_run_details())
        details_label.setWordWrap(True)
        details_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        details_label.setMinimumWidth(360)
        details_label.setMaximumWidth(460)
        layout.addWidget(details_label)

        action = QWidgetAction(menu)
        action.setDefaultWidget(container)
        menu.addAction(action)
        self._dda_run_details_menu = menu
        menu.aboutToHide.connect(self._clear_dda_run_details_menu)
        menu.popup(anchor.mapToGlobal(anchor.rect().bottomLeft()))

    def _clear_dda_run_details_menu(self) -> None:
        self._dda_run_details_menu = None

    def _format_dda_run_details(self) -> str:
        details = self.state.dda_run_details
        if details is None:
            return "No DDA execution is currently running."
        elapsed_seconds = (
            int(time.monotonic() - self._dda_run_started_at)
            if self._dda_run_started_at is not None
            else 0
        )
        channel_names = ", ".join(details.channel_names) or "—"
        channel_indices = ", ".join(str(index) for index in details.channel_indices) or "—"
        delays = ", ".join(str(delay) for delay in details.delays) or "—"
        model_terms = ", ".join(str(term) for term in details.model_terms) or "—"
        variants = ", ".join(details.variant_ids) or "—"
        sample_rate = f"{details.sample_rate_hz:.3f} Hz" if details.sample_rate_hz > 0 else "—"
        start_sample = max(int(round(details.start_time_seconds * details.sample_rate_hz)), 0)
        if details.end_time_seconds is None:
            end_sample = "end"
            bounds_seconds = f"{details.start_time_seconds:.2f}s → end"
        else:
            end_sample = str(max(int(round(details.end_time_seconds * details.sample_rate_hz)), start_sample))
            bounds_seconds = f"{details.start_time_seconds:.2f}s → {details.end_time_seconds:.2f}s"
        file_size_bytes = (
            self.state.selected_dataset.file_size_bytes
            if self.state.selected_dataset
            and self.state.selected_dataset.file_path == details.file_path
            else None
        )
        lines = [
            f"Dataset: {details.file_name}",
            f"Started: {details.started_at_iso}",
            f"Elapsed: {elapsed_seconds}s",
            f"Engine: {details.engine_label or self.backend.connection_label}",
            f"File path: {details.file_path}",
            f"File size: {_human_bytes(file_size_bytes)}",
            "",
            f"Variants: {variants}",
            f"Mode: {'Expert' if details.expert_mode else 'Standard EEG preset'}",
            f"Selected channels: {channel_indices}",
            f"Channel names: {channel_names}",
            f"Window: {details.window_length_samples}/{details.window_step_samples} samples",
            f"Delays: {delays}",
            "MODEL: "
            f"dm={details.model_dimension or self.DDA_DEFAULT_MODEL_DIMENSION}, "
            f"order={details.polynomial_order or self.DDA_DEFAULT_POLYNOMIAL_ORDER}, "
            f"nr_tau={details.nr_tau or self.DDA_DEFAULT_NR_TAU}, "
            f"terms={model_terms}",
            f"Bounds: {bounds_seconds} ({start_sample} → {end_sample} samples)",
            f"Sample rate: {sample_rate}",
        ]
        progress_headline, progress_detail = self._format_dda_progress_lines()
        if progress_headline:
            lines.extend(["", "Live progress:", progress_headline])
            if progress_detail:
                lines.append(progress_detail)
        if details.variant_channel_names:
            lines.extend(["", "Variant-specific selectors:"])
            for variant_id in details.variant_ids:
                pair_names = details.variant_pair_names.get(variant_id, [])
                if pair_names:
                    names = (
                        ", ".join(
                            self._format_dda_pair_label(variant_id, left, right)
                            for left, right in pair_names
                        )
                        or "—"
                    )
                    indices = (
                        ", ".join(
                            self._format_dda_pair_label(
                                variant_id,
                                str(left_index),
                                str(right_index),
                            )
                            for left_index, right_index in details.variant_pair_indices.get(
                                variant_id, []
                            )
                        )
                        or "—"
                    )
                    lines.append(f"{variant_id}: {indices} ({names})")
                    continue
                names = (
                    ", ".join(details.variant_channel_names.get(variant_id, [])) or "—"
                )
                indices = (
                    ", ".join(
                        str(index)
                        for index in details.variant_channel_indices.get(variant_id, [])
                    )
                    or "—"
                )
                lines.append(f"{variant_id}: {indices} ({names})")
        return "\n".join(lines)

    def _run_dda(self) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            self._show_error("Open a dataset before running DDA.")
            return
        variant_ids = self._active_dda_variant_ids()
        if not variant_ids:
            self._show_error("Select at least one DDA variant.")
            return
        variant_channel_names = self._selected_dda_variant_channel_names_map(variant_ids)
        variant_pair_names = self._selected_dda_variant_pair_names_map(variant_ids)
        missing_channel_variants = [
            variant_id
            for variant_id in variant_ids
            if variant_id in self.DDA_SINGLE_CHANNEL_VARIANTS
            and not variant_channel_names.get(variant_id)
        ]
        if missing_channel_variants:
            self._show_error(
                "Select at least one channel for: "
                + ", ".join(missing_channel_variants)
                + "."
            )
            return
        missing_pair_variants = [
            variant_id
            for variant_id in variant_ids
            if variant_id in self.DDA_PAIR_VARIANTS
            and not variant_pair_names.get(variant_id)
        ]
        if missing_pair_variants:
            self._show_error(
                "Select at least one pair for: "
                + ", ".join(missing_pair_variants)
                + "."
            )
            return
        variant_channel_indices = self._selected_dda_variant_channel_indices_map(
            dataset,
            variant_channel_names,
        )
        variant_pair_indices = self._selected_dda_variant_pair_indices_map(
            dataset,
            variant_pair_names,
        )
        selected_indices, selected_channel_names = self._union_channel_selection(
            dataset,
            variant_channel_indices,
            variant_pair_indices,
        )
        if not selected_indices:
            self._show_error("Select at least one DDA channel before running.")
            return
        window_length_samples = self.window_length_spin.value()
        window_step_samples = self.window_step_spin.value()
        try:
            delays = (
                self._parse_dda_delay_values()
                if self.state.expert_mode
                else list(self.DDA_DEFAULT_DELAYS)
            )
            model_terms, model_dimension, polynomial_order, nr_tau = (
                self._current_dda_model_parameters()
            )
        except ValueError as exc:
            self._show_error(str(exc))
            return
        start = float(self.dda_start_edit.text() or "0")
        end_text = self.dda_end_edit.text().strip()
        end = float(end_text) if end_text else None
        details = DdaRunDetails(
            file_name=dataset.file_name,
            file_path=dataset.file_path,
            started_at_iso=time.strftime("%Y-%m-%dT%H:%M:%S"),
            expert_mode=self.state.expert_mode,
            variant_ids=list(variant_ids),
            channel_names=list(selected_channel_names),
            channel_indices=list(selected_indices),
            variant_channel_names={
                variant_id: list(channel_names)
                for variant_id, channel_names in variant_channel_names.items()
            },
            variant_channel_indices={
                variant_id: list(channel_indices)
                for variant_id, channel_indices in variant_channel_indices.items()
            },
            variant_pair_names={
                variant_id: list(pair_names)
                for variant_id, pair_names in variant_pair_names.items()
            },
            variant_pair_indices={
                variant_id: list(pair_indices)
                for variant_id, pair_indices in variant_pair_indices.items()
            },
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=list(delays),
            model_terms=list(model_terms),
            model_dimension=model_dimension,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            start_time_seconds=start,
            end_time_seconds=end,
            sample_rate_hz=dataset.dominant_sample_rate_hz,
            engine_label=self.backend.connection_label,
        )
        self._set_dda_running_state(
            True,
            dataset_name=dataset.file_name,
            variant_ids=variant_ids,
            details=details,
        )

        def task(progress_callback) -> object:
            return self.backend.run_dda(
                dataset=dataset,
                selected_channel_indices=selected_indices,
                selected_variants=variant_ids,
                window_length_samples=window_length_samples,
                window_step_samples=window_step_samples,
                delays=delays,
                start_time_seconds=start,
                end_time_seconds=end,
                variant_channel_indices=variant_channel_indices,
                variant_pair_indices=variant_pair_indices,
                model_terms=model_terms,
                model_dimension=model_dimension,
                polynomial_order=polynomial_order,
                nr_tau=nr_tau,
                progress_callback=progress_callback,
            )

        def on_success(result: object) -> None:
            self._set_dda_running_state(False)
            dda_result = result
            if isinstance(dda_result, DdaResult):
                dda_result.reproduction = DdaReproductionConfig(
                    expert_mode=details.expert_mode,
                    variant_ids=list(details.variant_ids),
                    selected_channel_indices=list(details.channel_indices),
                    selected_channel_names=list(details.channel_names),
                    variant_channel_indices={
                        variant_id: list(channel_indices)
                        for variant_id, channel_indices in details.variant_channel_indices.items()
                    },
                    variant_channel_names={
                        variant_id: list(channel_names)
                        for variant_id, channel_names in details.variant_channel_names.items()
                    },
                    variant_pair_indices={
                        variant_id: list(pair_indices)
                        for variant_id, pair_indices in details.variant_pair_indices.items()
                    },
                    variant_pair_names={
                        variant_id: list(pair_names)
                        for variant_id, pair_names in details.variant_pair_names.items()
                    },
                    window_length_samples=details.window_length_samples,
                    window_step_samples=details.window_step_samples,
                    delays=list(details.delays),
                    model_terms=list(details.model_terms),
                    model_dimension=details.model_dimension,
                    polynomial_order=details.polynomial_order,
                    nr_tau=details.nr_tau,
                    start_time_seconds=details.start_time_seconds,
                    end_time_seconds=details.end_time_seconds,
                )
            self._apply_dda_result(dda_result)
            self._record_workflow_action(
                "run-dda",
                f"Ran DDA on {dataset.file_name}",
                {
                    "variants": ", ".join(variant_ids),
                    "channels": self._format_variant_channel_summary(
                        variant_channel_names,
                        variant_pair_names,
                    ),
                },
                file_path=dataset.file_path,
            )
            self._notify(
                "analysis",
                "info",
                "DDA Completed",
                f"{dataset.file_name} • {', '.join(variant_ids)}",
            )

        def on_error(message: str) -> None:
            self._set_dda_running_state(False)
            self.dda_diagnostics.setPlainText(f"DDA failed:\n{message}")
            self.result_summary.setPlainText(f"DDA failed.\n\n{message}")
            self._notify("analysis", "error", "DDA Failed", message)

        self._run_task_with_progress(
            task,
            on_success,
            on_error,
            self._update_dda_run_progress,
        )

    def _on_variant_changed(self, index: int) -> None:
        if index < 0:
            return
        self._active_variant_id = str(self.variant_combo.currentData())
        self._update_variant_view()
        self._schedule_session_save()

    def _on_heatmap_color_scheme_changed(self, index: int) -> None:
        if index < 0:
            return
        scheme = self.heatmap_color_scheme_combo.currentData()
        if isinstance(scheme, str):
            self.heatmap_widget.set_color_scheme(scheme)
            if hasattr(self, "compare_baseline_heatmap"):
                self.compare_baseline_heatmap.set_color_scheme(scheme)
                self.compare_target_heatmap.set_color_scheme(scheme)
            self._schedule_session_save()

    def _update_variant_view(self) -> None:
        result = self.state.dda_result
        if not result or not result.variants:
            self.heatmap_widget.set_variant(None)
            self.dda_lineplot_widget.set_variant(None)
            return
        variant = next(
            (item for item in result.variants if item.id == self._active_variant_id),
            result.variants[0],
        )
        view_key = (result.id, variant.id)
        self.heatmap_widget.set_variant(
            variant,
            result.window_centers_seconds,
            view_key=view_key,
        )
        self.dda_lineplot_widget.set_variant(
            variant,
            result.window_centers_seconds,
            view_key=view_key,
        )
        self.result_summary.setPlainText(
            f"{variant.label}\n\n"
            f"{variant.summary}\n\n"
            f"Rows: {len(variant.row_labels)}\n"
            f"Columns: {variant.effective_column_count}\n"
            f"Value range: {variant.min_value:.4f} → {variant.max_value:.4f}\n"
            f"Engine: {result.engine_label}\n"
            f"Created: {result.created_at_iso}"
        )

    def _update_ica_channel_summary(self) -> None:
        if not hasattr(self, "ica_channel_summary_label"):
            return
        dataset = self.state.selected_dataset
        if dataset is None:
            self.ica_channel_summary_label.setText("Open a dataset before running ICA.")
            return
        selected = self._selected_channel_names()
        channel_summary = (
            ", ".join(selected[:6]) if selected else "No channels selected"
        )
        if len(selected) > 6:
            channel_summary += f" +{len(selected) - 6} more"
        self.ica_channel_summary_label.setText(
            f"{dataset.file_name} • {len(selected)} selected channel(s) • {channel_summary}"
        )

    def _selected_ica_component(self):
        if not hasattr(self, "ica_components_table"):
            return None
        selected_rows = self.ica_components_table.selectionModel().selectedRows()
        if not selected_rows or self.state.ica_result is None:
            return None
        row = selected_rows[0].row()
        if row < 0 or row >= len(self.state.ica_result.components):
            return None
        return self.state.ica_result.components[row]

    def _update_ica_component_details(self) -> None:
        if not hasattr(self, "ica_component_details"):
            return
        component = self._selected_ica_component()
        if component is None:
            self.ica_component_details.setPlainText("")
            return
        power_preview = (
            ", ".join(f"{freq:.2f}Hz" for freq in component.power_frequencies[:8])
            or "—"
        )
        spatial_preview = (
            ", ".join(f"{value:.3f}" for value in component.spatial_map[:8]) or "—"
        )
        self.ica_component_details.setPlainText(
            f"Component {component.component_id}\n"
            f"Variance explained: {component.variance_explained:.4f}\n"
            f"Kurtosis: {component.kurtosis:.4f}\n"
            f"Non-gaussianity: {component.non_gaussianity:.4f}\n"
            f"Spatial map preview: {spatial_preview}\n"
            f"Power frequencies: {power_preview}"
        )

    def _apply_ica_result(
        self,
        result: Optional[IcaResult],
        *,
        persist: bool = True,
    ) -> None:
        self.state.ica_result = result
        if not hasattr(self, "ica_components_table"):
            return
        if result is None:
            self.ica_diagnostics.setPlainText("")
            self.ica_result_summary.setPlainText("")
            self.ica_components_table.setRowCount(0)
            self.ica_component_details.setPlainText("")
            self._refresh_results_page()
            return
        if persist:
            self.state_db.save_ica_result(result)
        self.ica_result_summary.setPlainText(
            f"ICA Result {result.id}\n\n"
            f"Channels: {len(result.channel_names)}\n"
            f"Components: {len(result.components)}\n"
            f"Sample rate: {result.sample_rate_hz:.2f} Hz\n"
            f"Samples: {result.sample_count}\n"
            f"Created: {result.created_at_iso}"
        )
        self.ica_components_table.setRowCount(len(result.components))
        for row, component in enumerate(result.components):
            values = [
                str(component.component_id),
                f"{component.variance_explained:.4f}",
                f"{component.kurtosis:.4f}",
                f"{component.non_gaussianity:.4f}",
            ]
            for column, value in enumerate(values):
                self.ica_components_table.setItem(row, column, QTableWidgetItem(value))
        self.ica_components_table.resizeColumnsToContents()
        if result.components:
            self.ica_components_table.selectRow(0)
        else:
            self.ica_component_details.setPlainText("")
        self._refresh_results_page()

    def _batch_candidate_paths(self) -> List[str]:
        seen: set[str] = set()
        candidates: List[str] = []
        for path in self.state.open_files:
            if path and path not in seen:
                candidates.append(path)
                seen.add(path)
        for entry in self.directory_entries:
            if entry.path in seen:
                continue
            if entry.open_as_dataset or (entry.supported and not entry.is_directory):
                candidates.append(entry.path)
                seen.add(entry.path)
        return candidates

    def _refresh_batch_candidates(self) -> None:
        if not hasattr(self, "batch_file_list"):
            return
        selected_paths = set(self._selected_batch_paths())
        default_selected = set(self.state.open_files)
        candidates = self._batch_candidate_paths()
        self.batch_file_list.blockSignals(True)
        self.batch_file_list.clear()
        for path in candidates:
            item = QListWidgetItem(Path(path).name or path)
            item.setData(Qt.UserRole, path)
            item.setToolTip(path)
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            should_select = path in selected_paths or (
                not selected_paths and path in default_selected
            )
            item.setCheckState(Qt.Checked if should_select else Qt.Unchecked)
            self.batch_file_list.addItem(item)
        self.batch_file_list.blockSignals(False)
        self.batch_run_button.setEnabled(bool(candidates))
        if not candidates:
            self.batch_status_label.setText(
                "Open files or browse a supported data directory to seed the batch queue."
            )

    def _selected_batch_paths(self) -> List[str]:
        if not hasattr(self, "batch_file_list"):
            return []
        selected: List[str] = []
        for index in range(self.batch_file_list.count()):
            item = self.batch_file_list.item(index)
            if item.checkState() == Qt.Checked:
                value = item.data(Qt.UserRole)
                if isinstance(value, str):
                    selected.append(value)
        return selected

    def _select_all_batch_files(self) -> None:
        for index in range(self.batch_file_list.count()):
            self.batch_file_list.item(index).setCheckState(Qt.Checked)

    def _select_open_batch_files(self) -> None:
        open_paths = set(self.state.open_files)
        for index in range(self.batch_file_list.count()):
            item = self.batch_file_list.item(index)
            item.setCheckState(
                Qt.Checked if item.data(Qt.UserRole) in open_paths else Qt.Unchecked
            )

    def _refresh_batch_results(self) -> None:
        if not hasattr(self, "batch_results_table"):
            return
        history = self.state.dda_history_summaries
        self.batch_results_table.setRowCount(len(history))
        for row, result in enumerate(history):
            values = [
                result.file_name,
                result.id[:8],
                ", ".join(result.variant_ids),
                result.created_at_iso,
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                item.setData(Qt.UserRole, result.id)
                self.batch_results_table.setItem(row, column, item)
        if history:
            self.batch_status_label.setText(
                f"{len(history)} batch/result history entr{'y' if len(history) == 1 else 'ies'} available."
            )
            latest_summary = history[0]
            self.batch_details.setPlainText(
                f"Latest result: {latest_summary.file_name}\n"
                f"Engine: {latest_summary.engine_label or '—'}\n"
                f"Variants: {', '.join(latest_summary.variant_ids) or '—'}\n"
                f"Created: {latest_summary.created_at_iso}"
            )
        else:
            self.batch_details.setPlainText("")

    def _run_batch_analysis(self) -> None:
        candidate_paths = self._selected_batch_paths()
        if not candidate_paths:
            self._show_error("Select at least one file before starting batch analysis.")
            return
        selected_channel_names = self._selected_channel_names()
        variant_ids = [
            key
            for key, checkbox in self.variant_checkboxes.items()
            if checkbox.isChecked()
        ]
        if not variant_ids:
            self._show_error(
                "Select at least one DDA variant before starting batch analysis."
            )
            return
        try:
            delays = (
                self._parse_dda_delay_values()
                if self.state.expert_mode
                else list(self.DDA_DEFAULT_DELAYS)
            )
            model_terms, model_dimension, polynomial_order, nr_tau = (
                self._current_dda_model_parameters()
            )
        except ValueError as exc:
            self._show_error(str(exc))
            return
        start = float(self.dda_start_edit.text() or "0")
        end_text = self.dda_end_edit.text().strip()
        end = float(end_text) if end_text else None
        window_length_samples = self.window_length_spin.value()
        window_step_samples = self.window_step_spin.value()
        self.batch_status_label.setText(
            f"Running batch analysis across {len(candidate_paths)} file(s)…"
        )
        self.batch_details.setPlainText("Submitting batch analysis…")

        def task() -> object:
            results: List[DdaResult] = []
            failures: List[str] = []
            for path in candidate_paths:
                try:
                    dataset = self.backend.load_dataset(path)
                    channel_names = (
                        selected_channel_names
                        or dataset.channel_names[: min(8, len(dataset.channel_names))]
                    )
                    selected_indices = [
                        dataset.channel_names.index(name)
                        for name in channel_names
                        if name in dataset.channel_names
                    ]
                    if not selected_indices:
                        raise RuntimeError("No analyzable channels")
                    results.append(
                        self.backend.run_dda(
                            dataset=dataset,
                            selected_channel_indices=selected_indices,
                            selected_variants=variant_ids,
                            window_length_samples=window_length_samples,
                            window_step_samples=window_step_samples,
                            delays=delays,
                            start_time_seconds=start,
                            end_time_seconds=end,
                            model_terms=model_terms,
                            model_dimension=model_dimension,
                            polynomial_order=polynomial_order,
                            nr_tau=nr_tau,
                        )
                    )
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"{Path(path).name}: {exc}")
            return {"results": results, "failures": failures}

        def on_success(result: object) -> None:
            payload = result if isinstance(result, dict) else {}
            results = payload.get("results") or []
            failures = payload.get("failures") or []
            if results:
                for batch_result in results:
                    if isinstance(batch_result, DdaResult):
                        self._remember_dda_result(batch_result)
                self._apply_dda_result(results[-1], persist=False)
            self.batch_status_label.setText(
                f"Batch finished: {len(results)}/{len(candidate_paths)} succeeded"
            )
            detail_lines = [f"Completed: {len(results)}", f"Failed: {len(failures)}"]
            if failures:
                detail_lines.extend(["", *failures[:10]])
            self.batch_details.setPlainText("\n".join(detail_lines))
            self._refresh_batch_results()
            self._record_workflow_action(
                "run-batch-dda",
                f"Ran batch DDA across {len(candidate_paths)} file(s)",
                {
                    "successes": str(len(results)),
                    "failures": str(len(failures)),
                },
            )
            self._notify(
                "analysis",
                "info" if results else "error",
                "Batch Finished",
                f"{len(results)} of {len(candidate_paths)} file(s) completed",
            )

        def on_error(message: str) -> None:
            self.batch_status_label.setText("Batch analysis failed")
            self.batch_details.setPlainText(message)
            self._notify("analysis", "error", "Batch Failed", message)

        self._run_task(task, on_success, on_error)


    def _connectivity_candidates(self) -> List[DdaResult]:
        return [
            summary
            for summary in self.state.dda_history_summaries
            if any(variant_id in {"CD", "CT", "SY"} for variant_id in summary.variant_ids)
        ]

    def _refresh_connectivity_sources(self) -> None:
        if not hasattr(self, "connectivity_result_combo"):
            return
        current_id = self.connectivity_result_combo.currentData()
        candidates = self._connectivity_candidates()
        with QSignalBlocker(self.connectivity_result_combo):
            self.connectivity_result_combo.clear()
            for result in candidates:
                self.connectivity_result_combo.addItem(
                    f"{result.file_name} • {result.created_at_iso}",
                    result.id,
                )
            if candidates:
                index = self.connectivity_result_combo.findData(current_id)
                self.connectivity_result_combo.setCurrentIndex(
                    index if index >= 0 else 0
                )

    def _refresh_connectivity_view(self) -> None:
        if not hasattr(self, "connectivity_table"):
            return
        self._connectivity_refresh_serial += 1
        refresh_serial = self._connectivity_refresh_serial
        result_id = self.connectivity_result_combo.currentData()
        candidates = self._connectivity_candidates()
        selected_summary = next(
            (item for item in candidates if item.id == result_id),
            candidates[0] if candidates else None,
        )
        selected = (
            self._cached_history_result(selected_summary.id)
            if selected_summary is not None
            else None
        )
        if selected_summary is not None and (
            selected is None or selected.id != selected_summary.id
        ):
            self.connectivity_summary.setPlainText("Loading connectivity views…")
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    "Loading network motif plots…"
                )
            if hasattr(self, "connectivity_motif_widget"):
                self.connectivity_motif_widget.set_motif_data(None)
            self.connectivity_table.setRowCount(0)
            self._load_dda_result_from_history_async(
                selected_summary.id,
                lambda _result: self._refresh_connectivity_view(),
            )
            return
        if selected is None:
            self.connectivity_summary.setPlainText(
                "Run DDA with CT, CD, or SY to inspect connectivity metrics."
            )
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    "Run DDA with CD to inspect directed causality motifs."
                )
            if hasattr(self, "connectivity_motif_widget"):
                self.connectivity_motif_widget.set_motif_data(None)
            self.connectivity_table.setRowCount(0)
            return
        self.connectivity_summary.setPlainText("Computing connectivity views…")
        if hasattr(self, "connectivity_motif_summary_label"):
            self.connectivity_motif_summary_label.setText(
                "Building network motif plots from the CD result…"
            )
        if hasattr(self, "connectivity_motif_widget"):
            self.connectivity_motif_widget.set_motif_data(None)
        self.connectivity_table.setRowCount(0)

        def task() -> object:
            return _build_connectivity_view_payload(selected)

        def on_success(result: object) -> None:
            if refresh_serial != self._connectivity_refresh_serial:
                return
            payload = result if isinstance(result, dict) else {}
            metrics = list(payload.get("metrics") or [])
            self.connectivity_summary.setPlainText(
                str(
                    payload.get("summary_text")
                    or "Run DDA with CT, CD, or SY to inspect connectivity metrics."
                )
            )
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    str(
                        payload.get("motif_summary")
                        or "Run DDA with CD to inspect directed causality motifs."
                    )
                )
            if hasattr(self, "connectivity_motif_widget"):
                motif_data = payload.get("motif_data")
                self.connectivity_motif_widget.set_motif_data(
                    motif_data if isinstance(motif_data, NetworkMotifData) else None
                )
            visible_metrics = metrics[:24]
            self.connectivity_table.setRowCount(len(visible_metrics))
            for row, metric in enumerate(visible_metrics):
                values = [
                    metric["label"],
                    f"{metric['mean_absolute']:.4f}",
                    f"{metric['peak_absolute']:.4f}",
                ]
                for column, value in enumerate(values):
                    self.connectivity_table.setItem(
                        row, column, QTableWidgetItem(value)
                    )

        def on_error(message: str) -> None:
            if refresh_serial != self._connectivity_refresh_serial:
                return
            self.connectivity_summary.setPlainText(
                f"Connectivity metrics failed:\n{message}"
            )
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    f"Connectivity motifs failed:\n{message}"
                )
            if hasattr(self, "connectivity_motif_widget"):
                self.connectivity_motif_widget.set_motif_data(None)
            self.connectivity_table.setRowCount(0)

        self._run_task(task, on_success, on_error)

    def _current_compare_config_payload(self) -> Dict[str, object]:
        baseline_id = (
            self.compare_baseline_combo.currentData()
            if hasattr(self, "compare_baseline_combo")
            else self._compare_baseline_id
        )
        target_id = (
            self.compare_target_combo.currentData()
            if hasattr(self, "compare_target_combo")
            else self._compare_target_id
        )
        variant_id = (
            self.compare_variant_combo.currentData()
            if hasattr(self, "compare_variant_combo")
            else self._compare_variant_id
        )
        return {
            "baselineId": str(baseline_id) if isinstance(baseline_id, str) else None,
            "targetId": str(target_id) if isinstance(target_id, str) else None,
            "variantId": str(variant_id) if isinstance(variant_id, str) else None,
            "viewMode": self._compare_view_mode,
            "selectedRowLabels": self._selected_compare_row_labels(),
        }

    def _apply_compare_config_payload(self, payload: object) -> None:
        if not isinstance(payload, dict):
            return
        baseline_id = payload.get("baselineId")
        target_id = payload.get("targetId")
        variant_id = payload.get("variantId")
        view_mode = payload.get("viewMode")
        selected_rows = payload.get("selectedRowLabels")
        self._compare_baseline_id = baseline_id if isinstance(baseline_id, str) else None
        self._compare_target_id = target_id if isinstance(target_id, str) else None
        self._compare_variant_id = variant_id if isinstance(variant_id, str) else None
        self._compare_view_mode = (
            view_mode
            if isinstance(view_mode, str)
            and view_mode in self.COMPARE_VIEW_MODE_ORDER
            else "summary"
        )
        self._compare_selected_row_labels = [
            str(label) for label in selected_rows if isinstance(label, str)
        ] if isinstance(selected_rows, list) else []
        self._compare_row_context_key = None
        if hasattr(self, "compare_view_nav"):
            self._set_compare_view_mode(self._compare_view_mode, schedule_save=False)

    def _compare_view_mode_index(self, mode: str) -> int:
        try:
            return self.COMPARE_VIEW_MODE_ORDER.index(mode)
        except ValueError:
            return 0

    def _set_compare_view_mode(
        self,
        mode: str,
        *,
        schedule_save: bool = True,
    ) -> None:
        normalized = (
            mode if mode in self.COMPARE_VIEW_MODE_ORDER else self.COMPARE_VIEW_MODE_ORDER[0]
        )
        self._compare_view_mode = normalized
        if hasattr(self, "compare_view_nav"):
            index = self._compare_view_mode_index(normalized)
            with QSignalBlocker(self.compare_view_nav):
                self.compare_view_nav.setCurrentIndex(index)
            self.compare_view_stack.setCurrentIndex(index)
        if schedule_save:
            self._schedule_session_save()

    def _selected_compare_row_labels(self) -> List[str]:
        if not hasattr(self, "compare_row_list"):
            return list(self._compare_selected_row_labels)
        labels: List[str] = []
        for index in range(self.compare_row_list.count()):
            item = self.compare_row_list.item(index)
            if item.checkState() != Qt.Checked:
                continue
            label = item.data(Qt.UserRole)
            if isinstance(label, str):
                labels.append(label)
        self._compare_selected_row_labels = list(labels)
        return labels

    def _on_compare_source_changed(self) -> None:
        self._compare_baseline_id = (
            self.compare_baseline_combo.currentData()
            if isinstance(self.compare_baseline_combo.currentData(), str)
            else None
        )
        self._compare_target_id = (
            self.compare_target_combo.currentData()
            if isinstance(self.compare_target_combo.currentData(), str)
            else None
        )
        self._compare_selected_row_labels = []
        self._compare_row_context_key = None
        self._refresh_compare_view()
        self._schedule_session_save()

    def _on_compare_variant_changed(self) -> None:
        self._compare_variant_id = (
            self.compare_variant_combo.currentData()
            if isinstance(self.compare_variant_combo.currentData(), str)
            else None
        )
        self._compare_selected_row_labels = []
        self._compare_row_context_key = None
        self._refresh_compare_view()
        self._schedule_session_save()

    def _on_compare_view_mode_changed(self, index: int) -> None:
        if index < 0 or index >= len(self.COMPARE_VIEW_MODE_ORDER):
            return
        self._set_compare_view_mode(self.COMPARE_VIEW_MODE_ORDER[index], schedule_save=False)
        self._schedule_session_save()

    def _on_compare_row_selection_changed(self, _item) -> None:
        self._compare_selected_row_labels = self._selected_compare_row_labels()
        self._refresh_compare_row_summary_label()
        self._refresh_compare_view()
        self._schedule_session_save()

    def _swap_compare_sources(self) -> None:
        baseline_id = self.compare_baseline_combo.currentData()
        target_id = self.compare_target_combo.currentData()
        if not isinstance(baseline_id, str) or not isinstance(target_id, str):
            return
        baseline_index = self.compare_baseline_combo.findData(target_id)
        target_index = self.compare_target_combo.findData(baseline_id)
        if baseline_index < 0 or target_index < 0:
            return
        with (
            QSignalBlocker(self.compare_baseline_combo),
            QSignalBlocker(self.compare_target_combo),
        ):
            self.compare_baseline_combo.setCurrentIndex(baseline_index)
            self.compare_target_combo.setCurrentIndex(target_index)
        self._compare_baseline_id = target_id
        self._compare_target_id = baseline_id
        self._compare_selected_row_labels = []
        self._compare_row_context_key = None
        self._refresh_compare_view()
        self._schedule_session_save()

    def _set_compare_row_selection(
        self,
        row_labels: List[str],
        *,
        schedule_save: bool = True,
    ) -> None:
        self._compare_selected_row_labels = list(row_labels)
        if hasattr(self, "compare_row_list"):
            selected_lookup = set(row_labels)
            with QSignalBlocker(self.compare_row_list):
                for index in range(self.compare_row_list.count()):
                    item = self.compare_row_list.item(index)
                    label = item.data(Qt.UserRole)
                    item.setCheckState(
                        Qt.Checked
                        if isinstance(label, str) and label in selected_lookup
                        else Qt.Unchecked
                    )
        self._refresh_compare_row_summary_label()
        self._refresh_compare_view()
        if schedule_save:
            self._schedule_session_save()

    def _select_all_compare_rows(self) -> None:
        labels: List[str] = []
        for index in range(self.compare_row_list.count()):
            item = self.compare_row_list.item(index)
            label = item.data(Qt.UserRole)
            if isinstance(label, str):
                labels.append(label)
        self._set_compare_row_selection(labels)

    def _clear_compare_rows(self) -> None:
        self._set_compare_row_selection([])

    def _select_top_changed_compare_rows(self) -> None:
        row_stats = getattr(self, "_latest_compare_row_stats", [])
        top_labels = self._default_compare_row_labels(row_stats)
        self._set_compare_row_selection(top_labels)

    def _on_compare_variant_table_selection_changed(self) -> None:
        if not hasattr(self, "compare_table"):
            return
        selected_rows = self.compare_table.selectionModel().selectedRows()
        if not selected_rows:
            return
        item = self.compare_table.item(selected_rows[0].row(), 0)
        variant_id = item.data(Qt.UserRole) if item is not None else None
        if not isinstance(variant_id, str):
            return
        combo_index = self.compare_variant_combo.findData(variant_id)
        if combo_index >= 0 and combo_index != self.compare_variant_combo.currentIndex():
            self.compare_variant_combo.setCurrentIndex(combo_index)

    def _compare_candidates(self) -> list:
        return list(self.state.dda_history_summaries)

    def _ordered_compare_variant_ids(
        self,
        baseline: DdaResult,
        target: DdaResult,
    ) -> List[str]:
        return _ordered_shared_variant_ids(
            baseline,
            target,
            list(self.DDA_VARIANT_ORDER),
        )

    def _refresh_compare_sources(self) -> None:
        if not hasattr(self, "compare_baseline_combo"):
            return
        baseline_id = self._compare_baseline_id or self.compare_baseline_combo.currentData()
        target_id = self._compare_target_id or self.compare_target_combo.currentData()
        candidates = self._compare_candidates()
        with (
            QSignalBlocker(self.compare_baseline_combo),
            QSignalBlocker(self.compare_target_combo),
        ):
            self.compare_baseline_combo.clear()
            self.compare_target_combo.clear()
            for result in candidates:
                label = f"{result.file_name} • {result.created_at_iso}"
                self.compare_baseline_combo.addItem(label, result.id)
                self.compare_target_combo.addItem(label, result.id)
            if candidates:
                baseline_index = self.compare_baseline_combo.findData(baseline_id)
                if baseline_index < 0:
                    baseline_index = 0
                self.compare_baseline_combo.setCurrentIndex(baseline_index)
                target_index = self.compare_target_combo.findData(target_id)
                if target_index < 0 or (
                    baseline_index == target_index and len(candidates) > 1
                ):
                    target_index = 1 if len(candidates) > 1 else 0
                self.compare_target_combo.setCurrentIndex(target_index)
        current_baseline = self.compare_baseline_combo.currentData()
        current_target = self.compare_target_combo.currentData()
        self._compare_baseline_id = current_baseline if isinstance(current_baseline, str) else None
        self._compare_target_id = current_target if isinstance(current_target, str) else None

    def _clear_compare_widgets(self, message: str) -> None:
        self.compare_summary.setPlainText(message)
        self.compare_shared_meta_label.setText(message)
        self.compare_table.setRowCount(0)
        self.compare_stats_table.setRowCount(0)
        self.compare_stats_summary.setPlainText(message)
        with QSignalBlocker(self.compare_variant_combo):
            self.compare_variant_combo.clear()
        with QSignalBlocker(self.compare_row_list):
            self.compare_row_list.clear()
        self.compare_row_summary_label.setText(
            "Choose the shared rows to use in heatmaps, lines, and statistics."
        )
        self.compare_baseline_heatmap.set_variant(None)
        self.compare_difference_heatmap.set_variant(None)
        self.compare_target_heatmap.set_variant(None)
        self.compare_overlay_lineplot.set_variant(None)
        self.compare_difference_lineplot.set_variant(None)
        self._latest_compare_row_stats = []

    def _refresh_compare_row_summary_label(self) -> None:
        if not hasattr(self, "compare_row_summary_label"):
            return
        total_rows = self.compare_row_list.count() if hasattr(self, "compare_row_list") else 0
        selected_rows = len(self._selected_compare_row_labels())
        if total_rows == 0:
            self.compare_row_summary_label.setText(
                "Choose the shared rows to use in heatmaps, lines, and statistics."
            )
            return
        if selected_rows == 0:
            self.compare_row_summary_label.setText(
                f"No rows selected. {total_rows} shared row{'s' if total_rows != 1 else ''} available."
            )
            return
        self.compare_row_summary_label.setText(
            f"{selected_rows} selected of {total_rows} shared row{'s' if total_rows != 1 else ''}."
        )

    def _default_compare_row_labels(self, row_stats: List[dict]) -> List[str]:
        return _default_compare_row_labels_from_stats(row_stats)

    def _populate_compare_row_selector(
        self,
        row_stats: List[dict],
        selected_labels: List[str],
    ) -> None:
        with QSignalBlocker(self.compare_row_list):
            self.compare_row_list.clear()
            selected_lookup = set(selected_labels)
            for metric in row_stats:
                item = QListWidgetItem(
                    f"{metric['row_label']} · mean |diff| {metric['mean_abs_diff']:.4f} · r {metric['correlation']:.3f}"
                    if math.isfinite(metric["correlation"])
                    else f"{metric['row_label']} · mean |diff| {metric['mean_abs_diff']:.4f}"
                )
                item.setData(Qt.UserRole, metric["row_label"])
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                item.setCheckState(
                    Qt.Checked if metric["row_label"] in selected_lookup else Qt.Unchecked
                )
                self.compare_row_list.addItem(item)
        self._refresh_compare_row_summary_label()

    def _set_compare_loading_state(self, message: str) -> None:
        self.compare_summary.setPlainText(message)
        self.compare_shared_meta_label.setText(message)
        self.compare_stats_summary.setPlainText(message)

    def _apply_compare_view_payload(self, payload: dict) -> None:
        comparisons = list(payload.get("comparisons") or [])
        selected_variant_id = (
            str(payload.get("selected_variant_id"))
            if isinstance(payload.get("selected_variant_id"), str)
            else None
        )
        self.compare_table.setRowCount(len(comparisons))
        with QSignalBlocker(self.compare_table):
            for row, metric in enumerate(comparisons):
                values = [
                    metric["variant_id"],
                    f"{metric['baseline_mean_abs']:.4f}",
                    f"{metric['target_mean_abs']:.4f}",
                    f"{metric['delta']:.4f}",
                    str(metric["shared_row_count"]),
                    metric["top_changed_row"] or "—",
                ]
                for column, value in enumerate(values):
                    item = QTableWidgetItem(value)
                    if column == 0:
                        item.setData(Qt.UserRole, metric["variant_id"])
                    self.compare_table.setItem(row, column, item)
            self.compare_table.clearSelection()
            for row, metric in enumerate(comparisons):
                if metric["variant_id"] == selected_variant_id:
                    self.compare_table.selectRow(row)
                    break

        shared_variant_ids = list(payload.get("shared_variant_ids") or [])
        variant_labels = dict(payload.get("variant_labels") or {})
        with QSignalBlocker(self.compare_variant_combo):
            self.compare_variant_combo.clear()
            for variant_id in shared_variant_ids:
                label = str(variant_labels.get(variant_id) or variant_id)
                self.compare_variant_combo.addItem(label, variant_id)
            if shared_variant_ids and selected_variant_id in shared_variant_ids:
                self.compare_variant_combo.setCurrentIndex(
                    self.compare_variant_combo.findData(selected_variant_id)
                )
        self._compare_variant_id = selected_variant_id

        row_stats = list(payload.get("row_stats") or [])
        selected_rows = list(payload.get("selected_rows") or [])
        self._latest_compare_row_stats = row_stats
        context_key = payload.get("context_key")
        self._compare_row_context_key = (
            tuple(context_key)
            if isinstance(context_key, tuple)
            else tuple(context_key)
            if isinstance(context_key, list)
            else None
        )
        self._compare_selected_row_labels = list(selected_rows)
        self._populate_compare_row_selector(row_stats, selected_rows)

        self.compare_shared_meta_label.setText(
            str(payload.get("shared_meta_text") or "")
        )
        self.compare_summary.setPlainText(str(payload.get("summary_text") or ""))

        scheme = self.heatmap_color_scheme_combo.currentData()
        if isinstance(scheme, str):
            self.compare_baseline_heatmap.set_color_scheme(scheme)
            self.compare_target_heatmap.set_color_scheme(scheme)
        self.compare_difference_heatmap.set_color_scheme("jet")
        self.compare_baseline_heatmap.set_variant(
            payload.get("baseline_display_variant"),
            list(payload.get("baseline_window_centers") or []),
            view_key=(
                payload.get("baseline_result_id"),
                selected_variant_id,
                "compare-baseline",
                tuple(selected_rows),
            ),
        )
        self.compare_target_heatmap.set_variant(
            payload.get("target_display_variant"),
            list(payload.get("target_window_centers") or []),
            view_key=(
                payload.get("target_result_id"),
                selected_variant_id,
                "compare-target",
                tuple(selected_rows),
            ),
        )
        self.compare_difference_heatmap.set_variant(
            payload.get("diff_display_variant"),
            list(payload.get("shared_window_centers") or []),
            view_key=(
                payload.get("baseline_result_id"),
                payload.get("target_result_id"),
                selected_variant_id,
                "compare-diff",
                tuple(selected_rows),
            ),
        )
        self.compare_overlay_lineplot.set_variant(
            payload.get("overlay_display_variant"),
            list(payload.get("shared_window_centers") or []),
            view_key=(
                payload.get("baseline_result_id"),
                payload.get("target_result_id"),
                selected_variant_id,
                "compare-overlay",
                tuple(selected_rows),
            ),
        )
        self.compare_difference_lineplot.set_variant(
            payload.get("diff_display_variant"),
            list(payload.get("shared_window_centers") or []),
            view_key=(
                payload.get("baseline_result_id"),
                payload.get("target_result_id"),
                selected_variant_id,
                "compare-diff-line",
                tuple(selected_rows),
            ),
        )

        visible_row_stats = list(payload.get("visible_row_stats") or [])
        self.compare_stats_table.setRowCount(len(visible_row_stats))
        for row, metric in enumerate(visible_row_stats):
            values = [
                metric["row_label"],
                _format_compare_numeric(metric["correlation"]),
                f"{metric['baseline_mean_abs']:.4f}",
                f"{metric['target_mean_abs']:.4f}",
                f"{metric['mean_abs_diff']:.4f}",
                f"{metric['max_abs_diff']:.4f}",
                f"{metric['rms_diff']:.4f}",
            ]
            for column, value in enumerate(values):
                self.compare_stats_table.setItem(row, column, QTableWidgetItem(value))
        self.compare_stats_summary.setPlainText(
            str(payload.get("stats_summary_text") or "")
        )

    def _refresh_compare_view(self) -> None:
        if not hasattr(self, "compare_table"):
            return
        self._compare_refresh_serial += 1
        refresh_serial = self._compare_refresh_serial
        candidates = self._compare_candidates()
        baseline_id = self.compare_baseline_combo.currentData()
        target_id = self.compare_target_combo.currentData()
        baseline_summary = next(
            (item for item in candidates if item.id == baseline_id), None
        )
        target_summary = next(
            (item for item in candidates if item.id == target_id), None
        )
        baseline = (
            self._cached_history_result(baseline_summary.id)
            if baseline_summary is not None
            else None
        )
        target = (
            self._cached_history_result(target_summary.id)
            if target_summary is not None
            else None
        )
        missing_ids = [
            summary.id
            for summary, result in (
                (baseline_summary, baseline),
                (target_summary, target),
            )
            if summary is not None and (result is None or result.id != summary.id)
        ]
        if missing_ids:
            self._clear_compare_widgets("Loading saved analyses for comparison…")
            for result_id in missing_ids:
                self._load_dda_result_from_history_async(
                    result_id,
                    lambda _result: self._refresh_compare_view(),
                )
            return
        if baseline is None or target is None or baseline.id == target.id:
            self._clear_compare_widgets(
                "Select two distinct analyses to compare their shared variants, rows, and trends."
            )
            return
        self._set_compare_loading_state("Computing comparison…")
        requested_variant_id = self._compare_variant_id
        requested_rows = list(self._compare_selected_row_labels)
        previous_context_key = self._compare_row_context_key
        variant_order = list(self.DDA_VARIANT_ORDER)

        def task() -> object:
            return _build_compare_view_payload(
                baseline,
                target,
                requested_variant_id,
                requested_rows,
                previous_context_key,
                variant_order,
            )

        def on_success(result: object) -> None:
            if refresh_serial != self._compare_refresh_serial:
                return
            payload = result if isinstance(result, dict) else {}
            if payload.get("status") != "ready":
                self._clear_compare_widgets(
                    str(
                        payload.get("message")
                        or "Select two distinct analyses to compare their shared variants, rows, and trends."
                    )
                )
                return
            self._apply_compare_view_payload(payload)

        def on_error(message: str) -> None:
            if refresh_serial != self._compare_refresh_serial:
                return
            self._clear_compare_widgets(f"Compare failed:\n{message}")

        self._run_task(task, on_success, on_error)

    def _run_ica(self) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            self._show_error("Open a dataset before running ICA.")
            return
        selected_channel_names = self._selected_channel_names()
        if len(selected_channel_names) < 2:
            self._show_error("Select at least two channels before running ICA.")
            return
        selected_indices = [
            dataset.channel_names.index(name)
            for name in selected_channel_names
            if name in dataset.channel_names
        ]
        start_text = self.ica_start_edit.text().strip()
        end_text = self.ica_end_edit.text().strip()
        start_seconds = float(start_text) if start_text else None
        end_seconds = float(end_text) if end_text else None
        n_components = self.ica_n_components_spin.value() or None
        max_iterations = self.ica_max_iterations_spin.value()
        tolerance = float(self.ica_tolerance_spin.value())
        centering = self.ica_centering_checkbox.isChecked()
        whitening = self.ica_whitening_checkbox.isChecked()
        self.ica_diagnostics.setPlainText("Submitting ICA analysis to backend…")

        def task() -> object:
            return self.backend.run_ica(
                dataset=dataset,
                selected_channel_indices=selected_indices,
                start_time_seconds=start_seconds,
                end_time_seconds=end_seconds,
                n_components=n_components,
                max_iterations=max_iterations,
                tolerance=tolerance,
                centering=centering,
                whitening=whitening,
            )

        def on_success(result: object) -> None:
            ica_result = result
            self.ica_diagnostics.setPlainText("ICA completed successfully.")
            self._apply_ica_result(ica_result)
            self._record_workflow_action(
                "run-ica",
                f"Ran ICA on {dataset.file_name}",
                {
                    "channels": ", ".join(selected_channel_names),
                    "components": str(n_components or "auto"),
                },
                file_path=dataset.file_path,
            )
            self._notify(
                "analysis",
                "info",
                "ICA Completed",
                f"{dataset.file_name} • {len(ica_result.components)} components",
            )

        def on_error(message: str) -> None:
            self.ica_diagnostics.setPlainText(f"ICA failed:\n{message}")
            self._notify("analysis", "error", "ICA Failed", message)

        self._run_task(task, on_success, on_error)


def _build_connectivity_view_payload(result: DdaResult) -> Dict[str, object]:
    cd_variant = next((item for item in result.variants if item.id == "CD"), None)
    metric_variant = cd_variant
    if metric_variant is None:
        metric_variant = next(
            (item for item in result.variants if item.id in {"CT", "SY"}),
            None,
        )
    metrics = (
        _build_connectivity_metrics(metric_variant)
        if metric_variant is not None
        else []
    )
    motif_data = None
    motif_summary = "Run DDA with CD to inspect directed causality motifs."
    if cd_variant is not None:
        motif_data = cd_variant.network_motifs or _rebuild_network_motif_data(
            result,
            cd_variant,
        )
        if motif_data is not None:
            cd_variant.network_motifs = motif_data
            total_edges = sum(
                len(matrix.edges) for matrix in motif_data.adjacency_matrices
            )
            formatted_delays = ", ".join(
                f"{delay:.2f}" for delay in motif_data.delay_values[:3]
            )
            motif_summary = (
                f"Directed CD causality across {motif_data.num_nodes} channels. "
                f"{len(motif_data.adjacency_matrices)} motif snapshots, "
                f"{total_edges} total edges, "
                f"tau {formatted_delays}."
            )
        else:
            motif_summary = (
                "CD results are available, but the channel-pair metadata needed to "
                "rebuild motif plots is missing."
            )
    return {
        "summary_text": (
            f"File: {result.file_name}\n"
            f"Metrics source: {metric_variant.id if metric_variant else '—'}\n"
            f"Rows: {len(metric_variant.row_labels) if metric_variant else 0}\n"
            f"Motifs: {'CD available' if motif_data is not None else 'unavailable'}\n"
            f"Metrics: {len(metrics)}"
        ),
        "metrics": metrics,
        "motif_data": motif_data,
        "motif_summary": motif_summary,
    }


def _rebuild_network_motif_data(
    result: DdaResult,
    variant: DdaVariantResult,
) -> Optional[NetworkMotifData]:
    reproduction = result.reproduction
    if reproduction is None:
        return None
    pair_indices = list(reproduction.variant_pair_indices.get("CD") or [])
    pair_names = list(reproduction.variant_pair_names.get("CD") or [])
    if not pair_indices:
        return None

    channel_name_lookup: Dict[int, str] = {}
    for index, name in zip(
        reproduction.selected_channel_indices,
        reproduction.selected_channel_names,
    ):
        channel_name_lookup[int(index)] = str(name)
    for (left_index, right_index), (left_name, right_name) in zip(
        pair_indices,
        pair_names,
    ):
        channel_name_lookup[int(left_index)] = str(left_name)
        channel_name_lookup[int(right_index)] = str(right_name)

    if channel_name_lookup:
        max_index = max(channel_name_lookup)
        channel_names = [
            channel_name_lookup.get(index, f"Ch{index + 1}")
            for index in range(max_index + 1)
        ]
    else:
        channel_names = []
    delays = reproduction.delays or list(range(variant.effective_column_count))
    return build_network_motif_data(
        q_matrix=variant.matrix,
        channel_pairs=pair_indices,
        channel_names=channel_names,
        delays=delays,
        threshold=0.25,
    )


def _ordered_shared_variant_ids(
    baseline: DdaResult,
    target: DdaResult,
    variant_order: List[str],
) -> List[str]:
    baseline_ids = {variant.id for variant in baseline.variants}
    target_ids = {variant.id for variant in target.variants}
    shared = baseline_ids & target_ids
    ordered = [variant_id for variant_id in variant_order if variant_id in shared]
    ordered.extend(
        sorted(variant_id for variant_id in shared if variant_id not in ordered)
    )
    return ordered


def _default_compare_row_labels_from_stats(row_stats: List[dict]) -> List[str]:
    ordered = sorted(
        row_stats,
        key=lambda item: item["mean_abs_diff"],
        reverse=True,
    )
    return [item["row_label"] for item in ordered[: min(6, len(ordered))]]


def _build_compare_view_payload(
    baseline: DdaResult,
    target: DdaResult,
    selected_variant_id: Optional[str],
    requested_row_labels: List[str],
    previous_context_key: Optional[tuple[str, str, str]],
    variant_order: List[str],
) -> Dict[str, object]:
    comparisons = _build_variant_comparisons(baseline, target)
    shared_variant_ids = _ordered_shared_variant_ids(baseline, target, variant_order)
    if not shared_variant_ids:
        return {
            "status": "empty",
            "message": (
                f"Baseline: {baseline.file_name}\n"
                f"Target: {target.file_name}\n\n"
                "These analyses do not share any DDA variants."
            ),
        }

    baseline_variants = {variant.id: variant for variant in baseline.variants}
    target_variants = {variant.id: variant for variant in target.variants}
    resolved_variant_id = (
        selected_variant_id
        if selected_variant_id in shared_variant_ids
        else shared_variant_ids[0]
    )
    baseline_variant = baseline_variants.get(resolved_variant_id)
    target_variant = target_variants.get(resolved_variant_id)
    if baseline_variant is None or target_variant is None:
        return {
            "status": "empty",
            "message": "Select a shared variant to compare.",
        }

    row_stats = _build_compare_row_statistics(baseline_variant, target_variant)
    shared_row_labels = [metric["row_label"] for metric in row_stats]
    context_key = (baseline.id, target.id, resolved_variant_id)
    selected_rows = [
        label for label in requested_row_labels if label in shared_row_labels
    ]
    if not selected_rows and context_key != previous_context_key:
        selected_rows = _default_compare_row_labels_from_stats(row_stats)

    shared_column_count = min(
        baseline_variant.effective_column_count,
        target_variant.effective_column_count,
    )
    shared_window_centers = _compare_window_centers(
        baseline,
        target,
        shared_column_count,
    )
    shared_min_value, shared_max_value = _shared_variant_value_bounds(
        baseline_variant,
        target_variant,
        selected_rows,
    )
    baseline_display_variant = _filtered_compare_variant(
        baseline_variant,
        selected_rows,
        min_value=shared_min_value,
        max_value=shared_max_value,
        summary_prefix="Baseline",
    )
    target_display_variant = _filtered_compare_variant(
        target_variant,
        selected_rows,
        min_value=shared_min_value,
        max_value=shared_max_value,
        summary_prefix="Target",
    )
    diff_display_variant = _difference_compare_variant(
        baseline_variant,
        target_variant,
        selected_rows,
        shared_column_count,
    )
    overlay_display_variant = _overlay_compare_variant(
        baseline_variant,
        target_variant,
        selected_rows,
        shared_column_count,
        baseline.file_name,
        target.file_name,
        min_value=shared_min_value,
        max_value=shared_max_value,
    )
    shared_row_count = len(row_stats)
    selected_row_count = len(selected_rows)
    overlap_notice = (
        f"Overlap columns: {shared_column_count}."
        if baseline_variant.effective_column_count
        != target_variant.effective_column_count
        else f"Columns per result: {shared_column_count}."
    )
    top_row = row_stats[0]["row_label"] if row_stats else "—"
    selected_row_lookup = set(selected_rows)
    visible_row_stats = [
        metric for metric in row_stats if metric["row_label"] in selected_row_lookup
    ]
    return {
        "status": "ready",
        "baseline_result_id": baseline.id,
        "target_result_id": target.id,
        "baseline_window_centers": list(baseline.window_centers_seconds),
        "target_window_centers": list(target.window_centers_seconds),
        "shared_window_centers": shared_window_centers,
        "comparisons": comparisons,
        "shared_variant_ids": shared_variant_ids,
        "variant_labels": {
            variant_id: baseline_variants[variant_id].label or variant_id
            for variant_id in shared_variant_ids
        },
        "selected_variant_id": resolved_variant_id,
        "row_stats": row_stats,
        "selected_rows": selected_rows,
        "context_key": context_key,
        "baseline_display_variant": baseline_display_variant,
        "target_display_variant": target_display_variant,
        "diff_display_variant": diff_display_variant,
        "overlay_display_variant": overlay_display_variant,
        "shared_meta_text": (
            f"Shared variant: {resolved_variant_id} • shared rows: {shared_row_count} "
            f"• selected rows: {selected_row_count} • {overlap_notice}"
        ),
        "summary_text": "\n".join(
            [
                f"Baseline: {baseline.file_name}",
                f"Target: {target.file_name}",
                f"Variant: {resolved_variant_id}",
                f"Shared variants: {len(shared_variant_ids)}",
                f"Shared rows: {shared_row_count}",
                f"Selected rows: {selected_row_count}",
                f"Baseline columns: {baseline_variant.effective_column_count}",
                f"Target columns: {target_variant.effective_column_count}",
                overlap_notice,
                f"Most changed row: {top_row}",
            ]
        ),
        "visible_row_stats": visible_row_stats,
        "stats_summary_text": "\n".join(
            [
                f"Comparing {resolved_variant_id} across {selected_row_count} selected row{'s' if selected_row_count != 1 else ''}.",
                f"Baseline engine: {baseline.engine_label}",
                f"Target engine: {target.engine_label}",
                "Difference values represent target minus baseline over the overlapping column span.",
            ]
        ),
    }


def _variant_by_row_label(variant: DdaVariantResult) -> Dict[str, List[float]]:
    return {
        label: list(variant.matrix[index]) if index < len(variant.matrix) else []
        for index, label in enumerate(variant.row_labels)
    }


def _finite_aligned_pairs(
    baseline_row: List[float],
    target_row: List[float],
) -> List[tuple[float, float]]:
    limit = min(len(baseline_row), len(target_row))
    pairs: List[tuple[float, float]] = []
    for index in range(limit):
        baseline_value = float(baseline_row[index])
        target_value = float(target_row[index])
        if not math.isfinite(baseline_value) or not math.isfinite(target_value):
            continue
        pairs.append((baseline_value, target_value))
    return pairs


def _mean_absolute(values: List[float]) -> float:
    finite = [abs(float(value)) for value in values if math.isfinite(float(value))]
    if not finite:
        return 0.0
    return sum(finite) / len(finite)


def _pearson_correlation(pairs: List[tuple[float, float]]) -> float:
    if len(pairs) < 2:
        return float("nan")
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    numerator = 0.0
    denominator_x = 0.0
    denominator_y = 0.0
    for x_value, y_value in pairs:
        dx = x_value - mean_x
        dy = y_value - mean_y
        numerator += dx * dy
        denominator_x += dx * dx
        denominator_y += dy * dy
    denominator = math.sqrt(denominator_x * denominator_y)
    if denominator <= 0.0:
        return float("nan")
    return numerator / denominator


def _build_compare_row_statistics(
    baseline_variant: DdaVariantResult,
    target_variant: DdaVariantResult,
) -> List[dict]:
    baseline_rows = _variant_by_row_label(baseline_variant)
    target_rows = _variant_by_row_label(target_variant)
    shared_labels = [
        label for label in baseline_variant.row_labels if label in target_rows
    ]
    row_stats: List[dict] = []
    for label in shared_labels:
        baseline_row = baseline_rows.get(label, [])
        target_row = target_rows.get(label, [])
        pairs = _finite_aligned_pairs(baseline_row, target_row)
        if pairs:
            diffs = [target_value - baseline_value for baseline_value, target_value in pairs]
            mean_abs_diff = sum(abs(value) for value in diffs) / len(diffs)
            max_abs_diff = max(abs(value) for value in diffs)
            rms_diff = math.sqrt(sum(value * value for value in diffs) / len(diffs))
        else:
            mean_abs_diff = 0.0
            max_abs_diff = 0.0
            rms_diff = 0.0
        row_stats.append(
            {
                "row_label": label,
                "baseline_mean_abs": _mean_absolute(baseline_row),
                "target_mean_abs": _mean_absolute(target_row),
                "mean_abs_diff": mean_abs_diff,
                "max_abs_diff": max_abs_diff,
                "rms_diff": rms_diff,
                "correlation": _pearson_correlation(pairs),
                "shared_points": len(pairs),
            }
        )
    return sorted(row_stats, key=lambda item: item["mean_abs_diff"], reverse=True)


def _row_bounds(matrix: List[List[float]]) -> tuple[float, float]:
    finite = [
        float(value)
        for row in matrix
        for value in row
        if math.isfinite(float(value))
    ]
    if not finite:
        return (0.0, 0.0)
    return (min(finite), max(finite))


def _shared_variant_value_bounds(
    baseline_variant: DdaVariantResult,
    target_variant: DdaVariantResult,
    row_labels: List[str],
) -> tuple[float, float]:
    baseline_rows = _variant_by_row_label(baseline_variant)
    target_rows = _variant_by_row_label(target_variant)
    selected_rows = row_labels or [
        label for label in baseline_variant.row_labels if label in target_rows
    ]
    combined: List[List[float]] = []
    for label in selected_rows:
        if label in baseline_rows:
            combined.append(baseline_rows[label])
        if label in target_rows:
            combined.append(target_rows[label])
    return _row_bounds(combined)


def _filtered_compare_variant(
    variant: DdaVariantResult,
    row_labels: List[str],
    *,
    min_value: float,
    max_value: float,
    summary_prefix: str,
) -> Optional[DdaVariantResult]:
    if not row_labels:
        return None
    row_lookup = _variant_by_row_label(variant)
    filtered_labels = [label for label in row_labels if label in row_lookup]
    matrix = [list(row_lookup[label]) for label in filtered_labels]
    if not matrix:
        return None
    row_mean_absolute = [_mean_absolute(row) for row in matrix]
    row_peak_absolute = [
        max((abs(float(value)) for value in row if math.isfinite(float(value))), default=0.0)
        for row in matrix
    ]
    return DdaVariantResult(
        id=variant.id,
        label=f"{summary_prefix} {variant.label}",
        row_labels=filtered_labels,
        matrix=matrix,
        summary=f"{summary_prefix} view for {variant.id}",
        min_value=min_value,
        max_value=max_value,
        column_count=max((len(row) for row in matrix), default=0),
        row_mean_absolute=row_mean_absolute,
        row_peak_absolute=row_peak_absolute,
    )


def _difference_compare_variant(
    baseline_variant: DdaVariantResult,
    target_variant: DdaVariantResult,
    row_labels: List[str],
    column_count: int,
) -> Optional[DdaVariantResult]:
    if not row_labels or column_count <= 0:
        return None
    baseline_rows = _variant_by_row_label(baseline_variant)
    target_rows = _variant_by_row_label(target_variant)
    matrix: List[List[float]] = []
    filtered_labels: List[str] = []
    for label in row_labels:
        baseline_row = baseline_rows.get(label)
        target_row = target_rows.get(label)
        if baseline_row is None or target_row is None:
            continue
        diff_row: List[float] = []
        for index in range(column_count):
            baseline_value = (
                float(baseline_row[index])
                if index < len(baseline_row)
                else float("nan")
            )
            target_value = (
                float(target_row[index])
                if index < len(target_row)
                else float("nan")
            )
            if not math.isfinite(baseline_value) or not math.isfinite(target_value):
                diff_row.append(float("nan"))
            else:
                diff_row.append(target_value - baseline_value)
        filtered_labels.append(label)
        matrix.append(diff_row)
    if not matrix:
        return None
    _, max_value = _row_bounds([[abs(value) for value in row] for row in matrix])
    symmetric_bound = max(max_value, 1e-6)
    row_mean_absolute = [_mean_absolute(row) for row in matrix]
    row_peak_absolute = [
        max((abs(float(value)) for value in row if math.isfinite(float(value))), default=0.0)
        for row in matrix
    ]
    return DdaVariantResult(
        id=f"{baseline_variant.id}-diff",
        label=f"{baseline_variant.label} Difference",
        row_labels=filtered_labels,
        matrix=matrix,
        summary="Target minus baseline over the overlapping window span.",
        min_value=-symmetric_bound,
        max_value=symmetric_bound,
        column_count=column_count,
        row_mean_absolute=row_mean_absolute,
        row_peak_absolute=row_peak_absolute,
    )


def _overlay_compare_variant(
    baseline_variant: DdaVariantResult,
    target_variant: DdaVariantResult,
    row_labels: List[str],
    column_count: int,
    baseline_label: str,
    target_label: str,
    *,
    min_value: float,
    max_value: float,
) -> Optional[DdaVariantResult]:
    if not row_labels or column_count <= 0:
        return None
    baseline_rows = _variant_by_row_label(baseline_variant)
    target_rows = _variant_by_row_label(target_variant)
    matrix: List[List[float]] = []
    overlay_labels: List[str] = []
    for label in row_labels:
        baseline_row = baseline_rows.get(label)
        target_row = target_rows.get(label)
        if baseline_row is None or target_row is None:
            continue
        overlay_labels.append(f"{baseline_label} · {label}")
        matrix.append(list(baseline_row[:column_count]))
        overlay_labels.append(f"{target_label} · {label}")
        matrix.append(list(target_row[:column_count]))
    if not matrix:
        return None
    row_mean_absolute = [_mean_absolute(row) for row in matrix]
    row_peak_absolute = [
        max((abs(float(value)) for value in row if math.isfinite(float(value))), default=0.0)
        for row in matrix
    ]
    return DdaVariantResult(
        id=f"{baseline_variant.id}-overlay",
        label=f"{baseline_variant.label} Overlay",
        row_labels=overlay_labels,
        matrix=matrix,
        summary="Baseline and target lines overlaid for the selected rows.",
        min_value=min_value,
        max_value=max_value,
        column_count=column_count,
        row_mean_absolute=row_mean_absolute,
        row_peak_absolute=row_peak_absolute,
    )


def _compare_window_centers(
    baseline: DdaResult,
    target: DdaResult,
    column_count: int,
) -> List[float]:
    if column_count <= 0:
        return []
    if len(baseline.window_centers_seconds) >= column_count:
        return list(baseline.window_centers_seconds[:column_count])
    if len(target.window_centers_seconds) >= column_count:
        return list(target.window_centers_seconds[:column_count])
    return [float(index) for index in range(column_count)]


def _format_compare_numeric(value: float) -> str:
    return f"{value:.4f}" if math.isfinite(value) else "—"
