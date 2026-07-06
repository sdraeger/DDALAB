from __future__ import annotations


from PySide6.QtCore import QTimer


class MainWindowUiBindingsMixin:
    def _bind_ui(self) -> None:
        self.refresh_button.clicked.connect(self._refresh_health)
        self.open_button.clicked.connect(self._choose_local_file)
        self.open_folder_button.clicked.connect(self._choose_local_folder)
        self.run_button.clicked.connect(self._run_dda)
        self.run_dda_from_page_button.clicked.connect(self._run_dda)
        self.window_length_spin.valueChanged.connect(
            lambda *_: self._schedule_session_save()
        )
        self.window_step_spin.valueChanged.connect(
            lambda *_: self._schedule_session_save()
        )
        self.delays_edit.textChanged.connect(lambda *_: self._schedule_session_save())
        self.dda_expert_mode_checkbox.toggled.connect(self._on_expert_mode_toggled)
        self.settings_expert_mode_checkbox.toggled.connect(self._on_expert_mode_toggled)
        self.dda_start_edit.textChanged.connect(
            lambda *_: self._schedule_session_save()
        )
        self.dda_end_edit.textChanged.connect(lambda *_: self._schedule_session_save())
        self.delays_edit.textChanged.connect(self._on_dda_expert_controls_changed)
        self.dda_model_dimension_spin.valueChanged.connect(
            self._on_dda_model_space_changed
        )
        self.dda_polynomial_order_spin.valueChanged.connect(
            self._on_dda_model_space_changed
        )
        self.dda_nr_tau_spin.valueChanged.connect(self._on_dda_model_space_changed)
        self.dda_model_terms_list.itemChanged.connect(self._on_dda_model_terms_changed)
        self.dda_apply_model_preset_button.clicked.connect(
            self._apply_selected_dda_model_preset
        )
        self.dda_reset_model_button.clicked.connect(self._reset_dda_model_to_default)
        self.ica_start_edit.textChanged.connect(
            lambda *_: self._schedule_session_save()
        )
        self.ica_end_edit.textChanged.connect(lambda *_: self._schedule_session_save())
        for variant_id, checkbox in self.variant_checkboxes.items():
            checkbox.toggled.connect(
                lambda checked,
                target_variant=variant_id: self._on_dda_variant_checkbox_toggled(
                    target_variant, checked
                )
            )
        self.dda_variant_selector_nav.currentChanged.connect(
            self._on_dda_variant_selector_changed
        )
        for variant_id, channel_list in self.dda_variant_channel_lists.items():
            channel_list.itemChanged.connect(
                lambda *_args,
                target_variant=variant_id: self._on_dda_variant_channel_list_changed(
                    target_variant
                )
            )
        for variant_id, filter_edit in self.dda_variant_channel_filter_edits.items():
            filter_edit.textChanged.connect(
                lambda *_args,
                target_variant=variant_id: self._apply_dda_variant_channel_filter(
                    target_variant
                )
            )
        for variant_id, button in self.dda_variant_channel_select_all_buttons.items():
            button.clicked.connect(
                lambda _checked=False,
                target_variant=variant_id: self._set_dda_variant_channels_checked(
                    target_variant, True
                )
            )
        for variant_id, button in self.dda_variant_channel_select_none_buttons.items():
            button.clicked.connect(
                lambda _checked=False,
                target_variant=variant_id: self._set_dda_variant_channels_checked(
                    target_variant, False
                )
            )
        for variant_id, pair_list in self.dda_variant_pair_lists.items():
            pair_list.itemSelectionChanged.connect(
                lambda target_variant=variant_id: self._update_dda_variant_pair_buttons(
                    target_variant
                )
            )
        for variant_id, filter_edit in self.dda_variant_pair_filter_edits.items():
            filter_edit.textChanged.connect(
                lambda *_args,
                target_variant=variant_id: self._apply_dda_variant_pair_filter(
                    target_variant
                )
            )
        for (
            variant_id,
            filter_edit,
        ) in self.dda_variant_pair_source_filter_edits.items():
            filter_edit.textChanged.connect(
                lambda *_args,
                target_variant=variant_id: self._apply_dda_variant_pair_combo_filters(
                    target_variant
                )
            )
        for (
            variant_id,
            filter_edit,
        ) in self.dda_variant_pair_target_filter_edits.items():
            filter_edit.textChanged.connect(
                lambda *_args,
                target_variant=variant_id: self._apply_dda_variant_pair_combo_filters(
                    target_variant
                )
            )
        for variant_id, button in self.dda_variant_pair_add_buttons.items():
            button.clicked.connect(
                lambda _checked=False,
                target_variant=variant_id: self._on_dda_variant_pair_add_requested(
                    target_variant
                )
            )
        for variant_id, button in self.dda_variant_pair_remove_buttons.items():
            button.clicked.connect(
                lambda _checked=False,
                target_variant=variant_id: self._on_dda_variant_pair_remove_requested(
                    target_variant
                )
            )
        for variant_id, button in self.dda_variant_pair_clear_buttons.items():
            button.clicked.connect(
                lambda _checked=False,
                target_variant=variant_id: self._on_dda_variant_pair_clear_requested(
                    target_variant
                )
            )
        self.run_ica_button.clicked.connect(self._run_ica)
        self.batch_select_all_button.clicked.connect(self._select_all_batch_files)
        self.batch_add_files_button.clicked.connect(self._add_batch_files)
        self.batch_select_open_button.clicked.connect(self._select_open_batch_files)
        self.batch_run_button.clicked.connect(self._run_batch_analysis)
        self.file_tabs.currentChanged.connect(self._on_tab_changed)
        self.file_tabs.tabCloseRequested.connect(self._close_file_tab)
        self.file_tabs.tabMoved.connect(self._on_file_tab_moved)
        self.file_tabs.customContextMenuRequested.connect(
            self._open_file_tab_context_menu
        )
        self.close_other_tabs_button.clicked.connect(self._close_other_tabs)
        self.primary_nav.currentChanged.connect(self._on_primary_nav_changed)
        self.secondary_nav.currentChanged.connect(self._on_secondary_nav_changed)

        self.file_browser.refresh_requested.connect(self._refresh_browser)
        self.file_browser.parent_requested.connect(self._open_parent_directory)
        self.file_browser.root_requested.connect(self._bootstrap_browser)
        self.file_browser.open_file_requested.connect(self._choose_local_file)
        self.file_browser.open_folder_requested.connect(self._choose_local_folder)
        self.file_browser.navigate_requested.connect(self._refresh_browser)
        self.file_browser.entry_activated.connect(self._open_entry)
        self.file_browser.context_action_requested.connect(
            self._handle_file_browser_context_action
        )
        self.file_browser.search_changed.connect(self._on_browser_search_changed)

        self.annotation_channel_filter_edit.textChanged.connect(
            lambda *_: self._populate_annotation_channels()
        )
        self.channel_filter_edit.textChanged.connect(
            lambda *_: self._apply_channel_list_filter()
        )
        self.select_all_channels_button.clicked.connect(self._select_all_channels)
        self.select_no_channels_button.clicked.connect(self._select_no_channels)
        self.select_top_eight_button.clicked.connect(
            lambda: self._select_top_channels(8)
        )
        self.select_top_four_button.clicked.connect(
            lambda: self._select_top_channels(4)
        )
        self.channel_list.itemChanged.connect(self._schedule_waveform_reload)
        self.waveform_widget.viewport_changed.connect(self._set_viewport)
        self.waveform_widget.annotation_context_requested.connect(
            self._open_waveform_annotation_context_menu
        )
        for checkbox in (
            self.waveform_layer_waveform_checkbox,
            self.waveform_layer_annotations_checkbox,
        ):
            checkbox.toggled.connect(lambda *_: self._on_waveform_plot_layers_changed())
        self.overview_widget.viewport_jump_requested.connect(self._jump_viewport)
        self.overview_widget.annotation_context_requested.connect(
            self._open_overview_annotation_context_menu
        )
        self.heatmap_widget.annotation_context_requested.connect(
            self._open_dda_heatmap_annotation_context_menu
        )
        self.heatmap_widget.view_window_changed.connect(self._sync_result_plot_viewport)
        self.heatmap_widget.cursor_fraction_changed.connect(
            self._sync_result_plot_cursor
        )
        self.dda_lineplot_widget.annotation_context_requested.connect(
            self._open_dda_lineplot_annotation_context_menu
        )
        self.dda_lineplot_widget.view_window_changed.connect(
            self._sync_result_plot_viewport
        )
        self.dda_lineplot_widget.cursor_fraction_changed.connect(
            self._sync_result_plot_cursor
        )
        for checkbox in (
            self.result_layer_heatmap_checkbox,
            self.result_layer_line_checkbox,
            self.result_layer_cursor_checkbox,
            self.result_layer_annotations_checkbox,
        ):
            checkbox.toggled.connect(lambda *_: self._on_result_plot_layers_changed())

        self.pan_left_button.clicked.connect(lambda: self._shift_viewport(-1.0))
        self.pan_right_button.clicked.connect(lambda: self._shift_viewport(1.0))
        self.zoom_in_button.clicked.connect(lambda: self._zoom_viewport(0.7))
        self.zoom_out_button.clicked.connect(lambda: self._zoom_viewport(1.4))
        self.reset_view_button.clicked.connect(self._reset_viewport)
        self.capture_annotation_button.clicked.connect(self._capture_annotation)
        self.jump_annotation_button.clicked.connect(self._jump_to_selected_annotation)
        self.delete_annotation_button.clicked.connect(self._delete_selected_annotation)
        self.import_annotations_button.clicked.connect(self._import_annotations)
        self.export_annotations_button.clicked.connect(self._export_annotations)
        self.annotations_table.itemSelectionChanged.connect(
            self._update_annotation_actions
        )
        self.annotations_table.itemDoubleClicked.connect(
            lambda *_: self._jump_to_selected_annotation()
        )
        self.streaming_start_button.clicked.connect(self._start_streaming)
        self.streaming_pause_button.clicked.connect(self._pause_streaming)
        self.streaming_stop_button.clicked.connect(self._stop_streaming)
        self.streaming_back_button.clicked.connect(lambda: self._step_streaming(-1.0))
        self.streaming_forward_button.clicked.connect(lambda: self._step_streaming(1.0))
        self.streaming_stride_spin.valueChanged.connect(
            lambda *_: self._update_streaming_ui()
        )
        self.streaming_speed_combo.currentIndexChanged.connect(
            lambda *_: self._update_streaming_ui()
        )
        self.streaming_loop_checkbox.toggled.connect(
            lambda *_: self._update_streaming_ui()
        )

        self.variant_combo.currentIndexChanged.connect(self._on_variant_changed)
        self.heatmap_color_scheme_combo.currentIndexChanged.connect(
            self._on_heatmap_color_scheme_changed
        )
        self.dda_import_snapshot_button.clicked.connect(self._import_snapshot)
        self.dda_snapshot_export_button.clicked.connect(self._export_snapshot)
        self.dda_view_history_result_button.clicked.connect(
            self._view_selected_history_result
        )
        self.dda_history_table.itemSelectionChanged.connect(
            self._on_results_history_selection_changed
        )
        self.dda_history_table.itemDoubleClicked.connect(
            self._view_selected_history_result
        )
        self.ica_components_table.itemSelectionChanged.connect(
            self._update_ica_component_details
        )
        self.connectivity_result_combo.currentIndexChanged.connect(
            self._refresh_connectivity_view
        )
        self.compare_baseline_combo.currentIndexChanged.connect(
            self._on_compare_source_changed
        )
        self.compare_target_combo.currentIndexChanged.connect(
            self._on_compare_source_changed
        )
        self.compare_swap_button.clicked.connect(self._swap_compare_sources)
        self.compare_variant_combo.currentIndexChanged.connect(
            self._on_compare_variant_changed
        )
        self.compare_view_nav.currentChanged.connect(self._on_compare_view_mode_changed)
        self.compare_row_list.itemChanged.connect(
            self._on_compare_row_selection_changed
        )
        self.compare_select_top_rows_button.clicked.connect(
            self._select_top_changed_compare_rows
        )
        self.compare_select_all_rows_button.clicked.connect(
            self._select_all_compare_rows
        )
        self.compare_clear_rows_button.clicked.connect(self._clear_compare_rows)
        self.compare_table.itemSelectionChanged.connect(
            self._on_compare_variant_table_selection_changed
        )
        self.theme_mode_combo.currentIndexChanged.connect(self._on_theme_mode_changed)
        self.openneuro_refresh_button.clicked.connect(self._load_openneuro)
        self.openneuro_load_more_button.clicked.connect(self._load_more_openneuro)
        self.openneuro_open_button.clicked.connect(
            self._open_selected_openneuro_dataset_page
        )
        self.openneuro_copy_id_button.clicked.connect(
            self._copy_selected_openneuro_dataset_id
        )
        self.openneuro_search.textChanged.connect(self._filter_openneuro_table)
        self.openneuro_table.itemSelectionChanged.connect(
            self._update_openneuro_details
        )
        if hasattr(self, "nsg_save_credentials_button"):
            self.nsg_save_credentials_button.clicked.connect(self._save_nsg_credentials)
            self.nsg_delete_credentials_button.clicked.connect(
                self._delete_nsg_credentials
            )
            self.nsg_test_connection_button.clicked.connect(self._test_nsg_connection)
            self.nsg_create_job_button.clicked.connect(self._create_nsg_job)
            self.nsg_refresh_jobs_button.clicked.connect(self._refresh_nsg_state)
            self.nsg_submit_job_button.clicked.connect(self._submit_selected_nsg_job)
            self.nsg_refresh_job_button.clicked.connect(self._refresh_selected_nsg_job)
            self.nsg_cancel_job_button.clicked.connect(self._cancel_selected_nsg_job)
            self.nsg_download_results_button.clicked.connect(
                self._download_selected_nsg_results
            )
            self.nsg_jobs_table.itemSelectionChanged.connect(self._update_nsg_panels)
        self.import_snapshot_button.clicked.connect(self._import_snapshot)
        self.snapshot_export_button.clicked.connect(self._export_snapshot)
        self.view_history_result_button.clicked.connect(
            self._view_selected_history_result
        )
        self.results_history_table.itemSelectionChanged.connect(
            self._on_results_history_selection_changed
        )
        self.results_history_table.itemDoubleClicked.connect(
            self._view_selected_history_result
        )
        self.start_workflow_button.clicked.connect(self._start_workflow_recording)
        self.stop_workflow_button.clicked.connect(self._stop_workflow_recording)
        self.clear_workflow_button.clicked.connect(self._clear_workflow_actions)
        self.export_workflow_button.clicked.connect(self._export_workflow)
        self.import_workflow_button.clicked.connect(self._import_workflow)
        self.export_notifications_button.clicked.connect(self._export_notifications)
        self.clear_notifications_button.clicked.connect(self._clear_notifications)
        self.settings_update_check_button.clicked.connect(
            self._on_check_for_updates_clicked
        )
        self.settings_update_install_button.clicked.connect(
            self._on_install_update_clicked
        )

        self.waveform_reload_timer = QTimer(self)
        self.waveform_reload_timer.setSingleShot(True)
        self.waveform_reload_timer.timeout.connect(self._load_waveform_data)

        self.overview_reload_timer = QTimer(self)
        self.overview_reload_timer.setSingleShot(True)
        self.overview_reload_timer.timeout.connect(self._load_waveform_overview)

        self.viewport_reload_timer = QTimer(self)
        self.viewport_reload_timer.setSingleShot(True)
        self.viewport_reload_timer.timeout.connect(self._load_waveform_data)

        self.streaming_timer = QTimer(self)
        self.streaming_timer.setInterval(120)
        self.streaming_timer.timeout.connect(self._advance_streaming)

        self.session_save_timer = QTimer(self)
        self.session_save_timer.setSingleShot(True)
        self.session_save_timer.timeout.connect(self._save_session_state)

        self.dda_activity_timer = QTimer(self)
        self.dda_activity_timer.setInterval(360)
        self.dda_activity_timer.timeout.connect(self._refresh_dda_running_ui)
        self.dda_activity_label.clicked.connect(
            lambda: self._show_dda_run_details_popover(self.dda_activity_label)
        )
        self.dda_global_label.clicked.connect(
            lambda: self._show_dda_run_details_popover(self.dda_global_label)
        )
