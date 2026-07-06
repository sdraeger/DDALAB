from __future__ import annotations

import os
from itertools import combinations_with_replacement
from typing import Dict, List, Optional

from PySide6.QtCore import QSignalBlocker, Qt
from PySide6.QtWidgets import (
    QListWidgetItem,
)

from ...backend.local import LocalBackendClient


class MainWindowAnalysisConfigMixin:
    def _batch_worker_count(self, candidate_count: int) -> int:
        if candidate_count <= 1:
            return 1
        cpu_count = os.cpu_count() or 2
        if isinstance(self.backend, LocalBackendClient):
            return max(1, min(candidate_count, max(2, min(4, cpu_count // 2 or 1))))
        return max(1, min(candidate_count, min(6, cpu_count)))

    def _build_batch_backend(self):
        if isinstance(self.backend, LocalBackendClient):
            return LocalBackendClient(self.runtime_paths)
        return self.backend

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
            raise ValueError("Invalid delay values: " + ", ".join(invalid_tokens) + ".")
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
            monomials.extend(
                tuple(combo) for combo in combinations_with_replacement(choices, degree)
            )
        return monomials

    def _sanitize_dda_model_terms(
        self,
        terms: Optional[List[int]],
        *,
        num_delays: int,
        polynomial_order: int,
    ) -> List[int]:
        total_terms = len(self._generate_dda_monomials(num_delays, polynomial_order))
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
        delays = (
            self._safe_dda_delay_values()
            if expert_mode
            else list(self.DDA_DEFAULT_DELAYS)
        )
        if expert_mode:
            summary_text = "Expert mode is active. The selected delays and MODEL encoding below will be sent directly to the DDA backend."
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
            summary_text = "Standard mode matches the archived DDALAB EEG preset: delays [7, 10], MODEL terms [1, 2, 10], dm=4, order=4, nr_tau=2."
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
                note += f" The model references {nr_tau} delay slots, but only {len(delays)} concrete delays are defined."
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
                item.setCheckState(
                    Qt.Checked if index in selected_lookup else Qt.Unchecked
                )
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
            self.delays_edit.setText(
                ",".join(str(delay) for delay in self.DDA_DEFAULT_DELAYS)
            )
        preset_index = self.dda_model_preset_combo.findData("eeg-standard")
        if preset_index >= 0:
            with QSignalBlocker(self.dda_model_preset_combo):
                self.dda_model_preset_combo.setCurrentIndex(preset_index)
        self._dda_model_terms = list(self.DDA_DEFAULT_MODEL_TERMS)
        self._refresh_dda_model_term_list()
        self._schedule_session_save()

    def _apply_expert_mode(
        self, enabled: object, *, schedule_save: bool = True
    ) -> None:
        normalized = bool(enabled)
        self.state.expert_mode = normalized
        if (
            hasattr(self, "dda_expert_mode_checkbox")
            and self.dda_expert_mode_checkbox.isChecked() != normalized
        ):
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
