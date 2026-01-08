use anyhow::{anyhow, Result};
use tera::{Context, Tera};

use super::actions::{ExportFormat, FileType, PlotType, TransformType, WorkflowAction};
use super::workflow::WorkflowGraph;

pub struct CodeGenerator {
    tera: Tera,
}

impl CodeGenerator {
    pub fn new() -> Result<Self> {
        let mut tera = Tera::default();

        // Add Python template
        tera.add_raw_template("workflow.py", PYTHON_TEMPLATE)?;

        // Add Julia template
        tera.add_raw_template("workflow.jl", JULIA_TEMPLATE)?;

        // Add MATLAB template
        tera.add_raw_template("workflow.m", MATLAB_TEMPLATE)?;

        // Add Rust template
        tera.add_raw_template("workflow.rs", RUST_TEMPLATE)?;

        // Add R template
        tera.add_raw_template("workflow.R", R_TEMPLATE)?;

        Ok(Self { tera })
    }

    pub fn generate_python(&self, workflow: &WorkflowGraph) -> Result<String> {
        let context = self.build_context(workflow, "python")?;
        self.tera
            .render("workflow.py", &context)
            .map_err(|e| anyhow!("Failed to render Python template: {}", e))
    }

    pub fn generate_julia(&self, workflow: &WorkflowGraph) -> Result<String> {
        let context = self.build_context(workflow, "julia")?;
        self.tera
            .render("workflow.jl", &context)
            .map_err(|e| anyhow!("Failed to render Julia template: {}", e))
    }

    pub fn generate_matlab(&self, workflow: &WorkflowGraph) -> Result<String> {
        let context = self.build_context(workflow, "matlab")?;
        self.tera
            .render("workflow.m", &context)
            .map_err(|e| anyhow!("Failed to render MATLAB template: {}", e))
    }

    pub fn generate_rust(&self, workflow: &WorkflowGraph) -> Result<String> {
        let context = self.build_context(workflow, "rust")?;
        self.tera
            .render("workflow.rs", &context)
            .map_err(|e| anyhow!("Failed to render Rust template: {}", e))
    }

    pub fn generate_r(&self, workflow: &WorkflowGraph) -> Result<String> {
        let context = self.build_context(workflow, "r")?;
        self.tera
            .render("workflow.R", &context)
            .map_err(|e| anyhow!("Failed to render R template: {}", e))
    }

    fn build_context(&self, workflow: &WorkflowGraph, language: &str) -> Result<Context> {
        let mut context = Context::new();

        // Get topological order
        let ordered_ids = workflow.get_topological_order()?;

        // Build ordered actions list
        let mut actions = Vec::new();
        for node_id in &ordered_ids {
            if let Some(node) = workflow.get_node(node_id) {
                let action_code = self.generate_action_code(&node.action, language)?;
                actions.push(ActionContext {
                    id: node.id.clone(),
                    code: action_code,
                    description: node.metadata.description.clone(),
                });
            }
        }

        context.insert("actions", &actions);
        context.insert("workflow_name", &workflow.metadata.name);
        context.insert("workflow_description", &workflow.metadata.description);

        Ok(context)
    }

    fn generate_action_code(&self, action: &WorkflowAction, language: &str) -> Result<String> {
        match language {
            "python" => self.generate_python_action(action),
            "julia" => self.generate_julia_action(action),
            "matlab" => self.generate_matlab_action(action),
            "rust" => self.generate_rust_action(action),
            "r" => self.generate_r_action(action),
            _ => Err(anyhow!("Unsupported language: {}", language)),
        }
    }

    fn generate_python_action(&self, action: &WorkflowAction) -> Result<String> {
        let code = match action {
            WorkflowAction::LoadFile { path, file_type } => match file_type {
                FileType::EDF => format!("file_path = '{}'", path),
                FileType::ASCII => {
                    format!("file_path = '{}'\n    data = np.loadtxt(file_path)", path)
                }
                FileType::CSV => {
                    format!("file_path = '{}'\n    data = pd.read_csv(file_path)", path)
                }
            },
            WorkflowAction::SetDDAParameters {
                window_length,
                window_step,
                ct_window_length,
                ct_window_step,
            } => {
                let mut params = format!(
                    "dda_params = {{\n        'window_length': {},\n        'window_step': {}",
                    window_length, window_step
                );
                if let Some(ct_wl) = ct_window_length {
                    params.push_str(&format!(",\n        'ct_window_length': {}", ct_wl));
                }
                if let Some(ct_ws) = ct_window_step {
                    params.push_str(&format!(",\n        'ct_window_step': {}", ct_ws));
                }
                params.push_str("\n    }");
                params
            }
            WorkflowAction::RunDDAAnalysis {
                input_id: _,
                channel_selection,
                ct_channel_pairs: _,
                cd_channel_pairs: _,
            } => {
                // Generate a proper DDARequest and run it with the runner
                format!(
                    r#"request = DDARequest(
        file_path=file_path,
        channels={},
        variants=dda_variants,
        window_length=dda_params.get('window_length', 2048),
        window_step=dda_params.get('window_step', 1024),
        delays=delay_list,
        ct_window_length=dda_params.get('ct_window_length'),
        ct_window_step=dda_params.get('ct_window_step'),
    )
    result = runner.run(request)"#,
                    format_list(channel_selection)
                )
            }
            WorkflowAction::ExportResults {
                result_id: _,
                format,
                path,
            } => match format {
                ExportFormat::CSV => format!("result.to_csv('{}')", path),
                ExportFormat::JSON => format!("result.to_json('{}')", path),
                ExportFormat::MAT => format!("scipy.io.savemat('{}', {{'result': result}})", path),
            },
            WorkflowAction::GeneratePlot {
                result_id: _,
                plot_type,
                options,
            } => {
                let title = options
                    .title
                    .as_ref()
                    .map(|t| format!(", title='{}'", t))
                    .unwrap_or_default();
                let cmap = options
                    .colormap
                    .as_ref()
                    .map(|c| format!(", cmap='{}'", c))
                    .unwrap_or_default();
                let normalize = if options.normalize {
                    ", normalize=True"
                } else {
                    ""
                };

                match plot_type {
                    PlotType::Heatmap => {
                        format!("plot_heatmap(result{}{}{})", title, cmap, normalize)
                    }
                    PlotType::TimeSeries => format!("plot_timeseries(result{})", title),
                    PlotType::StatisticalSummary => format!("plot_statistics(result{})", title),
                }
            }
            WorkflowAction::FilterChannels {
                input_id: _,
                channel_indices,
            } => {
                format!("data = data[{}]", format_list(channel_indices))
            }
            WorkflowAction::TransformData {
                input_id: _,
                transform_type,
            } => match transform_type {
                TransformType::Normalize => "data = (data - data.mean()) / data.std()".to_string(),
                TransformType::BandpassFilter {
                    low_freq,
                    high_freq,
                } => {
                    format!("data = bandpass_filter(data, {}, {})", low_freq, high_freq)
                }
                TransformType::Decimate { factor } => {
                    format!("data = scipy.signal.decimate(data, {}, axis=-1)", factor)
                }
                TransformType::Resample { target_rate } => {
                    format!("data = scipy.signal.resample(data, int(data.shape[-1] * {} / sampling_rate), axis=-1)", target_rate)
                }
                TransformType::BaselineCorrection { start, end } => {
                    format!("data = baseline_correct(data, {}, {})", start, end)
                }
            },
            WorkflowAction::CloseFile { file_id } => {
                format!("# Close file: {}", file_id)
            }
            WorkflowAction::SwitchActiveFile { file_id } => {
                format!("# Switch to file: {}", file_id)
            }
            WorkflowAction::SelectChannels { channel_indices } => {
                format!("selected_channels = {}", format_list(channel_indices))
            }
            WorkflowAction::DeselectChannels { channel_indices } => {
                format!("# Deselect channels: {}", format_list(channel_indices))
            }
            WorkflowAction::SelectAllChannels => {
                "selected_channels = list(range(len(data)))".to_string()
            }
            WorkflowAction::ClearChannelSelection => "selected_channels = []".to_string(),
            WorkflowAction::SetTimeWindow { start, end } => {
                format!("time_window = ({}, {})", start, end)
            }
            WorkflowAction::SelectDDAVariants { variants } => {
                format!("dda_variants = {}", format_list_str(variants))
            }
            WorkflowAction::SetDelayList { delays } => {
                format!("delay_list = {}", format_list_i32(delays))
            }
            WorkflowAction::SetModelParameters {
                dm,
                order,
                nr_tau,
                encoding,
            } => {
                format!(
                    "model_params = {{'dm': {}, 'order': {}, 'nr_tau': {}, 'encoding': {}}}",
                    dm,
                    order,
                    nr_tau,
                    format_list_i32(encoding)
                )
            }
            WorkflowAction::SetChunkWindow {
                chunk_start,
                chunk_size,
            } => {
                format!(
                    "chunk_window = (start={}, size={})",
                    chunk_start, chunk_size
                )
            }
            WorkflowAction::ApplyPreprocessing {
                input_id,
                preprocessing: _,
            } => {
                format!("# Apply preprocessing to {}", input_id)
            }
            WorkflowAction::AddAnnotation {
                annotation_type: _,
                details: _,
            } => "# Add annotation".to_string(),
            WorkflowAction::RemoveAnnotation { annotation_id } => {
                format!("# Remove annotation {}", annotation_id)
            }
            WorkflowAction::ExportPlot {
                plot_type: _,
                format: _,
                path,
            } => {
                format!("plt.savefig('{}')", path)
            }
            WorkflowAction::SaveAnalysisResult { result_id: _, name } => {
                format!("# Save analysis result: {}", name)
            }
            WorkflowAction::LoadAnalysisFromHistory { result_id } => {
                format!("# Load analysis from history: {}", result_id)
            }
            WorkflowAction::CompareAnalyses { result_ids: _ } => "# Compare analyses".to_string(),
        };

        Ok(code)
    }

    fn generate_julia_action(&self, action: &WorkflowAction) -> Result<String> {
        let code = match action {
            WorkflowAction::LoadFile { path, file_type } => match file_type {
                FileType::EDF => format!("file_path = \"{}\"", path),
                FileType::ASCII => {
                    format!("file_path = \"{}\"\n    data = readdlm(file_path)", path)
                }
                FileType::CSV => format!(
                    "file_path = \"{}\"\n    data = CSV.read(\"{}\", DataFrame)",
                    path, path
                ),
            },
            WorkflowAction::SetDDAParameters {
                window_length,
                window_step,
                ct_window_length,
                ct_window_step,
            } => {
                let mut params = format!(
                    "dda_params = (window_length={}, window_step={}",
                    window_length, window_step
                );
                if let Some(ct_wl) = ct_window_length {
                    params.push_str(&format!(", ct_window_length={}", ct_wl));
                }
                if let Some(ct_ws) = ct_window_step {
                    params.push_str(&format!(", ct_window_step={}", ct_ws));
                }
                params.push(')');
                params
            }
            WorkflowAction::RunDDAAnalysis {
                input_id: _,
                channel_selection,
                ct_channel_pairs: _,
                cd_channel_pairs: _,
            } => {
                // Generate a proper DDARequest and run it with the runner
                format!(
                    r#"request = DDARequest(
        file_path,
        {},  # channels (0-based)
        dda_variants;
        window_length=dda_params.window_length,
        window_step=dda_params.window_step,
        delays=delay_list,
        ct_window_length=get(dda_params, :ct_window_length, nothing),
        ct_window_step=get(dda_params, :ct_window_step, nothing)
    )
    result = run_analysis(runner, request)"#,
                    format_julia_array(channel_selection)
                )
            }
            WorkflowAction::ExportResults {
                result_id: _,
                format,
                path,
            } => match format {
                ExportFormat::CSV => format!("CSV.write(\"{}\", result)", path),
                ExportFormat::JSON => {
                    format!("open(\"{}\", \"w\") do f; JSON.print(f, result); end", path)
                }
                ExportFormat::MAT => {
                    format!("MAT.matwrite(\"{}\", Dict(\"result\" => result))", path)
                }
            },
            WorkflowAction::GeneratePlot {
                result_id: _,
                plot_type,
                options,
            } => {
                let title = options
                    .title
                    .as_ref()
                    .map(|t| format!(", title=\"{}\"", t))
                    .unwrap_or_default();
                let cmap = options
                    .colormap
                    .as_ref()
                    .map(|c| format!(", cmap=:{}", c))
                    .unwrap_or_default();
                let normalize = if options.normalize {
                    ", normalize=true"
                } else {
                    ""
                };

                match plot_type {
                    PlotType::Heatmap => {
                        format!("plot_heatmap_dda(result{}{}{})", title, cmap, normalize)
                    }
                    PlotType::TimeSeries => format!("plot_timeseries_dda(result{})", title),
                    PlotType::StatisticalSummary => format!("plot_statistics_dda(result{})", title),
                }
            }
            WorkflowAction::FilterChannels {
                input_id: _,
                channel_indices,
            } => {
                format!("data = data[{}, :]", format_julia_array(channel_indices))
            }
            WorkflowAction::TransformData {
                input_id: _,
                transform_type,
            } => match transform_type {
                TransformType::Normalize => "data = (data .- mean(data)) ./ std(data)".to_string(),
                TransformType::BandpassFilter {
                    low_freq,
                    high_freq,
                } => {
                    format!(
                        "data = bandpass_filter(data, {}, {}; fs=sampling_rate)",
                        low_freq, high_freq
                    )
                }
                TransformType::Decimate { factor } => {
                    format!("data = decimate(data, {})", factor)
                }
                TransformType::Resample { target_rate } => {
                    format!("data = resample(data, {})", target_rate)
                }
                TransformType::BaselineCorrection { start, end } => {
                    format!("data = baseline_correct(data, {}, {})", start, end)
                }
            },
            WorkflowAction::CloseFile { file_id } => {
                format!("# Close file: {}", file_id)
            }
            WorkflowAction::SwitchActiveFile { file_id } => {
                format!("# Switch to file: {}", file_id)
            }
            WorkflowAction::SelectChannels { channel_indices } => {
                format!(
                    "selected_channels = {}",
                    format_julia_array(channel_indices)
                )
            }
            WorkflowAction::DeselectChannels { channel_indices } => {
                format!(
                    "# Deselect channels: {}",
                    format_julia_array(channel_indices)
                )
            }
            WorkflowAction::SelectAllChannels => {
                "selected_channels = collect(1:size(data, 1))".to_string()
            }
            WorkflowAction::ClearChannelSelection => "selected_channels = []".to_string(),
            WorkflowAction::SetTimeWindow { start, end } => {
                format!("time_window = ({}, {})", start, end)
            }
            WorkflowAction::SelectDDAVariants { variants } => {
                format!("dda_variants = {}", format_julia_array_str(variants))
            }
            WorkflowAction::SetDelayList { delays } => {
                format!("delay_list = {}", format_julia_array_i32(delays))
            }
            WorkflowAction::SetModelParameters {
                dm,
                order,
                nr_tau,
                encoding,
            } => {
                format!(
                    "model_params = (dm={}, order={}, nr_tau={}, encoding={})",
                    dm,
                    order,
                    nr_tau,
                    format_julia_array_i32(encoding)
                )
            }
            WorkflowAction::SetChunkWindow {
                chunk_start,
                chunk_size,
            } => {
                format!(
                    "chunk_window = (start={}, size={})",
                    chunk_start, chunk_size
                )
            }
            WorkflowAction::ApplyPreprocessing {
                input_id,
                preprocessing: _,
            } => {
                format!("# Apply preprocessing to {}", input_id)
            }
            WorkflowAction::AddAnnotation {
                annotation_type: _,
                details: _,
            } => "# Add annotation".to_string(),
            WorkflowAction::RemoveAnnotation { annotation_id } => {
                format!("# Remove annotation {}", annotation_id)
            }
            WorkflowAction::ExportPlot {
                plot_type: _,
                format: _,
                path,
            } => {
                format!("savefig(\"{}\")", path)
            }
            WorkflowAction::SaveAnalysisResult { result_id: _, name } => {
                format!("# Save analysis result: {}", name)
            }
            WorkflowAction::LoadAnalysisFromHistory { result_id } => {
                format!("# Load analysis from history: {}", result_id)
            }
            WorkflowAction::CompareAnalyses { result_ids: _ } => "# Compare analyses".to_string(),
        };

        Ok(code)
    }

    fn generate_matlab_action(&self, action: &WorkflowAction) -> Result<String> {
        let code = match action {
            WorkflowAction::LoadFile { path, file_type } => match file_type {
                FileType::EDF => format!("data = edfread('{}');", path),
                FileType::ASCII => format!("data = load('{}');", path),
                FileType::CSV => format!("data = readmatrix('{}');", path),
            },
            WorkflowAction::SetDDAParameters {
                window_length,
                window_step,
                ct_window_length,
                ct_window_step,
            } => {
                let mut params = format!(
                    "dda_params.window_length = {};\ndda_params.window_step = {};",
                    window_length, window_step
                );
                if let Some(ct_wl) = ct_window_length {
                    params.push_str(&format!("\ndda_params.ct_window_length = {};", ct_wl));
                }
                if let Some(ct_ws) = ct_window_step {
                    params.push_str(&format!("\ndda_params.ct_window_step = {};", ct_ws));
                }
                params
            }
            WorkflowAction::RunDDAAnalysis {
                input_id: _,
                channel_selection,
                ct_channel_pairs: _,
                cd_channel_pairs: _,
            } => {
                format!(
                    "result = run_dda_analysis(data, {}, dda_params);",
                    format_matlab_array(channel_selection)
                )
            }
            WorkflowAction::ExportResults {
                result_id: _,
                format,
                path,
            } => match format {
                ExportFormat::CSV => format!("writematrix(result, '{}');", path),
                ExportFormat::JSON => format!("jsonwrite('{}', result);", path),
                ExportFormat::MAT => format!("save('{}', 'result');", path),
            },
            WorkflowAction::GeneratePlot {
                result_id: _,
                plot_type,
                options,
            } => {
                let title = options
                    .title
                    .as_ref()
                    .map(|t| format!("; title('{}');", t))
                    .unwrap_or_default();

                match plot_type {
                    PlotType::Heatmap => format!("imagesc(result){}", title),
                    PlotType::TimeSeries => format!("plot(result){}", title),
                    PlotType::StatisticalSummary => format!("boxplot(result){}", title),
                }
            }
            WorkflowAction::FilterChannels {
                input_id: _,
                channel_indices,
            } => {
                format!("data = data({}, :);", format_matlab_array(channel_indices))
            }
            WorkflowAction::TransformData {
                input_id: _,
                transform_type,
            } => match transform_type {
                TransformType::Normalize => "data = (data - mean(data)) ./ std(data);".to_string(),
                TransformType::BandpassFilter {
                    low_freq,
                    high_freq,
                } => {
                    format!("data = bandpass(data, [{}, {}], fs);", low_freq, high_freq)
                }
                TransformType::Decimate { factor } => {
                    format!("data = decimate(data, {});", factor)
                }
                TransformType::Resample { target_rate } => {
                    format!("data = resample(data, {});", target_rate)
                }
                TransformType::BaselineCorrection { start, end } => {
                    format!("data = baseline_correct(data, {}, {});", start, end)
                }
            },
            WorkflowAction::CloseFile { file_id } => {
                format!("% Close file: {}", file_id)
            }
            WorkflowAction::SwitchActiveFile { file_id } => {
                format!("% Switch to file: {}", file_id)
            }
            WorkflowAction::SelectChannels { channel_indices } => {
                format!(
                    "selected_channels = {};",
                    format_matlab_array(channel_indices)
                )
            }
            WorkflowAction::DeselectChannels { channel_indices } => {
                format!(
                    "% Deselect channels: {}",
                    format_matlab_array(channel_indices)
                )
            }
            WorkflowAction::SelectAllChannels => "selected_channels = 1:size(data, 1);".to_string(),
            WorkflowAction::ClearChannelSelection => "selected_channels = [];".to_string(),
            WorkflowAction::SetTimeWindow { start, end } => {
                format!("time_window = [{}, {}];", start, end)
            }
            WorkflowAction::SelectDDAVariants { variants } => {
                format!("dda_variants = {};", format_matlab_string_array(variants))
            }
            WorkflowAction::SetDelayList { delays } => {
                format!("delay_list = {};", format_matlab_array_i32(delays))
            }
            WorkflowAction::SetModelParameters {
                dm,
                order,
                nr_tau,
                encoding,
            } => {
                format!(
                    "model_params = struct('dm', {}, 'order', {}, 'nr_tau', {}, 'encoding', {});",
                    dm,
                    order,
                    nr_tau,
                    format_matlab_array_i32(encoding)
                )
            }
            WorkflowAction::SetChunkWindow {
                chunk_start,
                chunk_size,
            } => {
                format!(
                    "chunk_window = struct('start', {}, 'size', {});",
                    chunk_start, chunk_size
                )
            }
            WorkflowAction::ApplyPreprocessing {
                input_id,
                preprocessing: _,
            } => {
                format!("% Apply preprocessing to {}", input_id)
            }
            WorkflowAction::AddAnnotation {
                annotation_type: _,
                details: _,
            } => "% Add annotation".to_string(),
            WorkflowAction::RemoveAnnotation { annotation_id } => {
                format!("% Remove annotation {}", annotation_id)
            }
            WorkflowAction::ExportPlot {
                plot_type: _,
                format: _,
                path,
            } => {
                format!("saveas(gcf, '{}');", path)
            }
            WorkflowAction::SaveAnalysisResult { result_id: _, name } => {
                format!("% Save analysis result: {}", name)
            }
            WorkflowAction::LoadAnalysisFromHistory { result_id } => {
                format!("% Load analysis from history: {}", result_id)
            }
            WorkflowAction::CompareAnalyses { result_ids: _ } => "% Compare analyses".to_string(),
        };

        Ok(code)
    }

    fn generate_rust_action(&self, action: &WorkflowAction) -> Result<String> {
        let code = match action {
            WorkflowAction::LoadFile { path, file_type } => match file_type {
                FileType::EDF => format!("let file_path = \"{}\".to_string();", path),
                FileType::ASCII => format!("let file_path = \"{}\".to_string();\n    // Note: ASCII files need preprocessing before DDA", path),
                FileType::CSV => format!("let file_path = \"{}\".to_string();\n    // Note: CSV files need preprocessing before DDA", path),
            },
            WorkflowAction::SetDDAParameters {
                window_length,
                window_step,
                ct_window_length,
                ct_window_step,
            } => {
                let mut params = format!(
                    "let window_params = WindowParameters {{\n        window_length: {},\n        window_step: {},",
                    window_length, window_step
                );
                if let Some(ct_wl) = ct_window_length {
                    params.push_str(&format!("\n        ct_window_length: Some({}),", ct_wl));
                } else {
                    params.push_str("\n        ct_window_length: None,");
                }
                if let Some(ct_ws) = ct_window_step {
                    params.push_str(&format!("\n        ct_window_step: Some({}),", ct_ws));
                } else {
                    params.push_str("\n        ct_window_step: None,");
                }
                params.push_str("\n    };");
                params
            }
            WorkflowAction::RunDDAAnalysis {
                input_id: _,
                channel_selection,
                ct_channel_pairs: _,
                cd_channel_pairs: _,
            } => {
                // Generate a proper DDARequest and run it with the runner
                format!(
                    r#"let request = DDARequest {{
        file_path: file_path.clone(),
        channels: Some({}),
        window_parameters: window_params.clone(),
        delay_parameters: delay_params.clone(),
        algorithm_selection: AlgorithmSelection {{
            select_mask: Some(dda_rs::generate_select_mask(&dda_variants)),
        }},
        time_range: None,
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: None,
        sampling_rate: None,
    }};
    let result = runner.run(&request, None, None, None).await?;"#,
                    format_rust_array(channel_selection)
                )
            }
            WorkflowAction::ExportResults {
                result_id: _,
                format,
                path,
            } => match format {
                ExportFormat::CSV => format!("result.to_csv(\"{}\")?;", path),
                ExportFormat::JSON => format!("result.to_json(\"{}\")?;", path),
                ExportFormat::MAT => format!("// MAT export not supported in Rust"),
            },
            WorkflowAction::GeneratePlot {
                result_id: _,
                plot_type,
                options,
            } => {
                let title = options
                    .title
                    .as_ref()
                    .map(|t| format!(", title: \"{}\"", t))
                    .unwrap_or_default();

                match plot_type {
                    PlotType::Heatmap => format!("plot_heatmap(&result{})?;", title),
                    PlotType::TimeSeries => format!("plot_timeseries(&result{})?;", title),
                    PlotType::StatisticalSummary => format!("plot_statistics(&result{})?;", title),
                }
            }
            WorkflowAction::FilterChannels {
                input_id: _,
                channel_indices,
            } => {
                format!(
                    "let data = filter_channels(&data, &{})?;",
                    format_rust_array(channel_indices)
                )
            }
            WorkflowAction::TransformData {
                input_id: _,
                transform_type,
            } => match transform_type {
                TransformType::Normalize => "let data = normalize(&data)?;".to_string(),
                TransformType::BandpassFilter {
                    low_freq,
                    high_freq,
                } => {
                    format!(
                        "let data = bandpass_filter(&data, {}, {})?;",
                        low_freq, high_freq
                    )
                }
                TransformType::Decimate { factor } => {
                    format!("let data = decimate(&data, {})?;", factor)
                }
                TransformType::Resample { target_rate } => {
                    format!("let data = resample(&data, {})?;", target_rate)
                }
                TransformType::BaselineCorrection { start, end } => {
                    format!("let data = baseline_correct(&data, {}, {})?;", start, end)
                }
            },
            WorkflowAction::CloseFile { file_id } => {
                format!("// Close file: {}", file_id)
            }
            WorkflowAction::SwitchActiveFile { file_id } => {
                format!("// Switch to file: {}", file_id)
            }
            WorkflowAction::SelectChannels { channel_indices } => {
                format!(
                    "let selected_channels = {};",
                    format_rust_array(channel_indices)
                )
            }
            WorkflowAction::DeselectChannels { channel_indices } => {
                format!("// Deselect channels: {:?}", channel_indices)
            }
            WorkflowAction::SelectAllChannels => {
                "let selected_channels = (0..data.len()).collect::<Vec<_>>();".to_string()
            }
            WorkflowAction::ClearChannelSelection => {
                "let selected_channels: Vec<usize> = Vec::new();".to_string()
            }
            WorkflowAction::SetTimeWindow { start, end } => {
                format!("let time_window = ({}, {});", start, end)
            }
            WorkflowAction::SelectDDAVariants { variants } => {
                format!("let dda_variants: Vec<String> = {};", format_rust_string_array(variants))
            }
            WorkflowAction::SetDelayList { delays } => {
                format!(
                    "let delay_params = DelayParameters {{\n        delays: {},\n    }};",
                    format_rust_array_i32(delays)
                )
            }
            WorkflowAction::SetModelParameters {
                dm,
                order,
                nr_tau,
                encoding,
            } => {
                format!("let model_params = ModelParams {{ dm: {}, order: {}, nr_tau: {}, encoding: {} }};",
                    dm, order, nr_tau, format_rust_array_i32(encoding))
            }
            WorkflowAction::SetChunkWindow {
                chunk_start,
                chunk_size,
            } => {
                format!("let chunk_window = ({}, {});", chunk_start, chunk_size)
            }
            WorkflowAction::ApplyPreprocessing {
                input_id,
                preprocessing: _,
            } => {
                format!("// Apply preprocessing to {}", input_id)
            }
            WorkflowAction::AddAnnotation {
                annotation_type: _,
                details: _,
            } => "// Add annotation".to_string(),
            WorkflowAction::RemoveAnnotation { annotation_id } => {
                format!("// Remove annotation {}", annotation_id)
            }
            WorkflowAction::ExportPlot {
                plot_type: _,
                format: _,
                path,
            } => {
                format!("// Export plot to {}", path)
            }
            WorkflowAction::SaveAnalysisResult { result_id: _, name } => {
                format!("// Save analysis result: {}", name)
            }
            WorkflowAction::LoadAnalysisFromHistory { result_id } => {
                format!("// Load analysis from history: {}", result_id)
            }
            WorkflowAction::CompareAnalyses { result_ids: _ } => "// Compare analyses".to_string(),
        };

        Ok(code)
    }

    fn generate_r_action(&self, action: &WorkflowAction) -> Result<String> {
        let code = match action {
            WorkflowAction::LoadFile { path, file_type } => match file_type {
                FileType::EDF => format!("data <- read_edf(\"{}\")", path),
                FileType::ASCII => format!("data <- read.table(\"{}\")", path),
                FileType::CSV => format!("data <- read.csv(\"{}\")", path),
            },
            WorkflowAction::SetDDAParameters {
                window_length,
                window_step,
                ct_window_length,
                ct_window_step,
            } => {
                let mut params = format!(
                    "dda_params <- list(\n  window_length = {},\n  window_step = {}",
                    window_length, window_step
                );
                if let Some(ct_wl) = ct_window_length {
                    params.push_str(&format!(",\n  ct_window_length = {}", ct_wl));
                }
                if let Some(ct_ws) = ct_window_step {
                    params.push_str(&format!(",\n  ct_window_step = {}", ct_ws));
                }
                params.push_str("\n)");
                params
            }
            WorkflowAction::RunDDAAnalysis {
                input_id: _,
                channel_selection,
                ct_channel_pairs: _,
                cd_channel_pairs: _,
            } => {
                format!(
                    "result <- run_dda_analysis(data, channels = {}, dda_params)",
                    format_r_array(channel_selection)
                )
            }
            WorkflowAction::ExportResults {
                result_id: _,
                format,
                path,
            } => match format {
                ExportFormat::CSV => format!("write.csv(result, \"{}\")", path),
                ExportFormat::JSON => format!("jsonlite::write_json(result, \"{}\")", path),
                ExportFormat::MAT => format!("R.matlab::writeMat(\"{}\", result = result)", path),
            },
            WorkflowAction::GeneratePlot {
                result_id: _,
                plot_type,
                options,
            } => {
                let title = options
                    .title
                    .as_ref()
                    .map(|t| format!(", main = \"{}\"", t))
                    .unwrap_or_default();

                match plot_type {
                    PlotType::Heatmap => format!("heatmap(result{})", title),
                    PlotType::TimeSeries => format!("plot(result, type = \"l\"{})", title),
                    PlotType::StatisticalSummary => format!("boxplot(result{})", title),
                }
            }
            WorkflowAction::FilterChannels {
                input_id: _,
                channel_indices,
            } => {
                format!("data <- data[{}, ]", format_r_array(channel_indices))
            }
            WorkflowAction::TransformData {
                input_id: _,
                transform_type,
            } => match transform_type {
                TransformType::Normalize => "data <- scale(data)".to_string(),
                TransformType::BandpassFilter {
                    low_freq,
                    high_freq,
                } => {
                    format!("data <- bandpass_filter(data, {}, {})", low_freq, high_freq)
                }
                TransformType::Decimate { factor } => {
                    format!("data <- decimate(data, {})", factor)
                }
                TransformType::Resample { target_rate } => {
                    format!("data <- resample(data, {})", target_rate)
                }
                TransformType::BaselineCorrection { start, end } => {
                    format!("data <- baseline_correct(data, {}, {})", start, end)
                }
            },
            WorkflowAction::CloseFile { file_id } => {
                format!("# Close file: {}", file_id)
            }
            WorkflowAction::SwitchActiveFile { file_id } => {
                format!("# Switch to file: {}", file_id)
            }
            WorkflowAction::SelectChannels { channel_indices } => {
                format!("selected_channels <- {}", format_r_array(channel_indices))
            }
            WorkflowAction::DeselectChannels { channel_indices } => {
                format!("# Deselect channels: {}", format_r_array(channel_indices))
            }
            WorkflowAction::SelectAllChannels => "selected_channels <- 1:nrow(data)".to_string(),
            WorkflowAction::ClearChannelSelection => "selected_channels <- c()".to_string(),
            WorkflowAction::SetTimeWindow { start, end } => {
                format!("time_window <- c({}, {})", start, end)
            }
            WorkflowAction::SelectDDAVariants { variants } => {
                format!("dda_variants <- {}", format_r_string_array(variants))
            }
            WorkflowAction::SetDelayList { delays } => {
                format!("delay_list <- {}", format_r_array_i32(delays))
            }
            WorkflowAction::SetModelParameters {
                dm,
                order,
                nr_tau,
                encoding,
            } => {
                format!(
                    "model_params <- list(dm = {}, order = {}, nr_tau = {}, encoding = {})",
                    dm,
                    order,
                    nr_tau,
                    format_r_array_i32(encoding)
                )
            }
            WorkflowAction::SetChunkWindow {
                chunk_start,
                chunk_size,
            } => {
                format!(
                    "chunk_window <- list(start = {}, size = {})",
                    chunk_start, chunk_size
                )
            }
            WorkflowAction::ApplyPreprocessing {
                input_id,
                preprocessing: _,
            } => {
                format!("# Apply preprocessing to {}", input_id)
            }
            WorkflowAction::AddAnnotation {
                annotation_type: _,
                details: _,
            } => "# Add annotation".to_string(),
            WorkflowAction::RemoveAnnotation { annotation_id } => {
                format!("# Remove annotation {}", annotation_id)
            }
            WorkflowAction::ExportPlot {
                plot_type: _,
                format: _,
                path,
            } => {
                format!("ggsave(\"{}\")", path)
            }
            WorkflowAction::SaveAnalysisResult { result_id: _, name } => {
                format!("# Save analysis result: {}", name)
            }
            WorkflowAction::LoadAnalysisFromHistory { result_id } => {
                format!("# Load analysis from history: {}", result_id)
            }
            WorkflowAction::CompareAnalyses { result_ids: _ } => "# Compare analyses".to_string(),
        };

        Ok(code)
    }
}

fn format_list(items: &[usize]) -> String {
    format!(
        "[{}]",
        items
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_julia_array(items: &[usize]) -> String {
    format!(
        "[{}]",
        items
            .iter()
            .map(|i| (i + 1).to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_list_str(items: &[String]) -> String {
    format!(
        "[{}]",
        items
            .iter()
            .map(|s| format!("'{}'", s))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_julia_array_str(items: &[String]) -> String {
    format!(
        "[{}]",
        items
            .iter()
            .map(|s| format!("\"{}\"", s))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_list_i32(items: &[i32]) -> String {
    format!(
        "[{}]",
        items
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_julia_array_i32(items: &[i32]) -> String {
    format!(
        "[{}]",
        items
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

// MATLAB formatting functions
fn format_matlab_array(items: &[usize]) -> String {
    format!(
        "[{}]",
        items
            .iter()
            .map(|i| (i + 1).to_string()) // MATLAB uses 1-based indexing
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_matlab_array_i32(items: &[i32]) -> String {
    format!(
        "[{}]",
        items
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_matlab_string_array(items: &[String]) -> String {
    format!(
        "{{{}}}",
        items
            .iter()
            .map(|s| format!("'{}'", s))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

// Rust formatting functions
fn format_rust_array(items: &[usize]) -> String {
    format!(
        "vec![{}]",
        items
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_rust_array_i32(items: &[i32]) -> String {
    format!(
        "vec![{}]",
        items
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_rust_string_array(items: &[String]) -> String {
    format!(
        "vec![{}]",
        items
            .iter()
            .map(|s| format!("\"{}\".to_string()", s))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

// R formatting functions
fn format_r_array(items: &[usize]) -> String {
    format!(
        "c({})",
        items
            .iter()
            .map(|i| (i + 1).to_string()) // R uses 1-based indexing
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_r_array_i32(items: &[i32]) -> String {
    format!(
        "c({})",
        items
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_r_string_array(items: &[String]) -> String {
    format!(
        "c({})",
        items
            .iter()
            .map(|s| format!("\"{}\"", s))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

#[derive(serde::Serialize)]
struct ActionContext {
    id: String,
    code: String,
    description: Option<String>,
}

const PYTHON_TEMPLATE: &str = r#"#!/usr/bin/env python3
"""
{{ workflow_name }}
{% if workflow_description %}
{{ workflow_description }}
{% endif %}

Generated by DDALAB Session Recording

Requirements:
    pip install dda-py numpy pandas scipy matplotlib
"""

import numpy as np
import pandas as pd
import scipy.io
import scipy.signal as signal
import matplotlib.pyplot as plt

# DDA Python bindings - install with: pip install dda-py
from dda_py import DDARunner, DDARequest


def plot_heatmap(result, title=None, cmap='viridis', normalize=False):
    """Generate heatmap visualization from DDA results"""
    # Extract Q matrix from first variant
    variant_name = list(result.keys())[0]
    matrix = np.array(result[variant_name]['matrix'])

    if normalize:
        matrix = (matrix - matrix.min()) / (matrix.max() - matrix.min())

    plt.figure(figsize=(12, 6))
    plt.imshow(matrix, aspect='auto', cmap=cmap)
    if title:
        plt.title(title)
    plt.xlabel('Time Window')
    plt.ylabel('Channel')
    plt.colorbar(label='Q Value')
    plt.tight_layout()
    plt.show()


def plot_timeseries(result, title=None):
    """Generate time series visualization from DDA results"""
    variant_name = list(result.keys())[0]
    matrix = np.array(result[variant_name]['matrix'])

    plt.figure(figsize=(12, 6))
    for i, channel in enumerate(matrix):
        plt.plot(channel, label=f'Channel {i+1}', alpha=0.7)

    if title:
        plt.title(title)
    plt.xlabel('Time Window')
    plt.ylabel('Q Value')
    plt.legend(loc='upper right')
    plt.tight_layout()
    plt.show()


def plot_statistics(result, title=None):
    """Generate statistical summary visualization from DDA results"""
    variant_name = list(result.keys())[0]
    matrix = np.array(result[variant_name]['matrix'])

    fig, axes = plt.subplots(1, 3, figsize=(15, 5))

    # Mean per channel
    axes[0].bar(range(len(matrix)), [ch.mean() for ch in matrix])
    axes[0].set_title('Mean Q per Channel')
    axes[0].set_xlabel('Channel')
    axes[0].set_ylabel('Mean Q')

    # Standard deviation per channel
    axes[1].bar(range(len(matrix)), [ch.std() for ch in matrix])
    axes[1].set_title('Std Dev Q per Channel')
    axes[1].set_xlabel('Channel')
    axes[1].set_ylabel('Std Q')

    # Distribution of all Q values
    axes[2].hist(matrix.flatten(), bins=50, edgecolor='black')
    axes[2].set_title('Q Value Distribution')
    axes[2].set_xlabel('Q Value')
    axes[2].set_ylabel('Frequency')

    if title:
        fig.suptitle(title)

    plt.tight_layout()
    plt.show()


def bandpass_filter(data, low_freq, high_freq, fs=256):
    """Apply bandpass filter to data"""
    nyq = fs / 2
    low = low_freq / nyq
    high = high_freq / nyq
    b, a = signal.butter(4, [low, high], btype='band')
    return signal.filtfilt(b, a, data, axis=-1)


def main():
    """Execute workflow"""
    # Initialize DDA runner (auto-discovers binary or set path explicitly)
    # runner = DDARunner(binary_path="/path/to/run_DDA_AsciiEdf")
    runner = DDARunner()

{% for action in actions %}
    # {{ action.id }}{% if action.description %}: {{ action.description }}{% endif %}
    {{ action.code }}
{% endfor %}

if __name__ == '__main__':
    main()
"#;

const JULIA_TEMPLATE: &str = r#"#!/usr/bin/env julia
"""
{{ workflow_name }}
{% if workflow_description %}
{{ workflow_description }}
{% endif %}

Generated by DDALAB Session Recording

Requirements:
    ] add DelayDifferentialAnalysis CSV DataFrames JSON MAT Plots
"""

using CSV
using DataFrames
using JSON
using MAT
using DelimitedFiles
using Statistics
using Plots

# DDA Julia bindings
using DelayDifferentialAnalysis


function plot_heatmap_dda(result; title=nothing, cmap=:viridis, normalize=false)
    """Generate heatmap visualization from DDA results"""
    matrix = result.q_matrix

    if normalize
        matrix = (matrix .- minimum(matrix)) ./ (maximum(matrix) - minimum(matrix))
    end

    p = heatmap(matrix, c=cmap, xlabel="Time Window", ylabel="Channel", colorbar_title="Q Value")
    if title !== nothing
        title!(p, title)
    end
    display(p)
end


function plot_timeseries_dda(result; title=nothing)
    """Generate time series visualization from DDA results"""
    matrix = result.q_matrix
    num_channels = size(matrix, 1)

    p = plot(xlabel="Time Window", ylabel="Q Value", legend=:topright)
    for i in 1:num_channels
        plot!(p, matrix[i, :], label="Channel $i", alpha=0.7)
    end

    if title !== nothing
        title!(p, title)
    end
    display(p)
end


function plot_statistics_dda(result; title=nothing)
    """Generate statistical summary visualization from DDA results"""
    matrix = result.q_matrix
    num_channels = size(matrix, 1)

    means = [mean(matrix[i, :]) for i in 1:num_channels]
    stds = [std(matrix[i, :]) for i in 1:num_channels]

    p1 = bar(1:num_channels, means, xlabel="Channel", ylabel="Mean Q", title="Mean Q per Channel")
    p2 = bar(1:num_channels, stds, xlabel="Channel", ylabel="Std Q", title="Std Dev Q per Channel")
    p3 = histogram(vec(matrix), xlabel="Q Value", ylabel="Frequency", title="Q Value Distribution", bins=50)

    p = plot(p1, p2, p3, layout=(1, 3), size=(1200, 400))
    if title !== nothing
        plot!(p, plot_title=title)
    end
    display(p)
end


function bandpass_filter(data, low_freq, high_freq; fs=256.0)
    """Apply bandpass filter to data"""
    using DSP
    responsetype = Bandpass(low_freq, high_freq; fs=fs)
    designmethod = Butterworth(4)
    return filtfilt(digitalfilter(responsetype, designmethod), data)
end


function main()
    """Execute workflow"""
    # Initialize DDA runner (auto-discovers binary or set path explicitly)
    # runner = DDARunner("/path/to/run_DDA_AsciiEdf")
    runner = DDARunner()

{% for action in actions %}
    # {{ action.id }}{% if action.description %}: {{ action.description }}{% endif %}
    {{ action.code }}
{% endfor %}
end

main()
"#;

const MATLAB_TEMPLATE: &str = r#"%% {{ workflow_name }}
{% if workflow_description %}
% {{ workflow_description }}
{% endif %}
%
% Generated by DDALAB Session Recording

function main()
{% for action in actions %}
    % {{ action.id }}{% if action.description %}: {{ action.description }}{% endif %}
    {{ action.code }}
{% endfor %}
end

main();
"#;

const RUST_TEMPLATE: &str = r#"//! {{ workflow_name }}
{% if workflow_description %}
//! {{ workflow_description }}
{% endif %}
//!
//! Generated by DDALAB Session Recording
//!
//! Requirements:
//!     Add to Cargo.toml: dda-rs = "0.1"

use anyhow::Result;
use dda_rs::{DDARunner, DDARequest, WindowParameters, DelayParameters, AlgorithmSelection};
use std::path::Path;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize DDA runner (auto-discovers binary or set path explicitly)
    // let runner = DDARunner::new("/path/to/run_DDA_AsciiEdf")?;
    let runner = DDARunner::discover()?;

{% for action in actions %}
    // {{ action.id }}{% if action.description %}: {{ action.description }}{% endif %}
    {{ action.code }}
{% endfor %}

    Ok(())
}
"#;

const R_TEMPLATE: &str = r#"#!/usr/bin/env Rscript
# {{ workflow_name }}
{% if workflow_description %}
# {{ workflow_description }}
{% endif %}
#
# Generated by DDALAB Session Recording

library(edfReader)  # For EDF file support
library(jsonlite)    # For JSON export
library(R.matlab)    # For MAT file support

main <- function() {
{% for action in actions %}
  # {{ action.id }}{% if action.description %}: {{ action.description }}{% endif %}
  {{ action.code }}
{% endfor %}
}

main()
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recording::actions::WorkflowNode;
    use crate::recording::workflow::WorkflowGraph;

    #[test]
    fn test_code_generator_creation() {
        let generator = CodeGenerator::new();
        assert!(generator.is_ok());
    }

    #[test]
    fn test_generate_python_simple() {
        let generator = CodeGenerator::new().unwrap();
        let mut workflow = WorkflowGraph::new("test_workflow".to_string());

        let node = WorkflowNode::new(
            "load_file".to_string(),
            WorkflowAction::LoadFile {
                path: "/test/data.edf".to_string(),
                file_type: FileType::EDF,
            },
        );

        workflow.add_node(node).unwrap();

        let result = generator.generate_python(&workflow);
        assert!(result.is_ok());
        let code = result.unwrap();
        // LoadFile action generates file_path assignment
        assert!(code.contains("file_path = "));
        assert!(code.contains("/test/data.edf"));
    }

    #[test]
    fn test_generate_julia_simple() {
        let generator = CodeGenerator::new().unwrap();
        let mut workflow = WorkflowGraph::new("test_workflow".to_string());

        let node = WorkflowNode::new(
            "load_file".to_string(),
            WorkflowAction::LoadFile {
                path: "/test/data.csv".to_string(),
                file_type: FileType::CSV,
            },
        );

        workflow.add_node(node).unwrap();

        let result = generator.generate_julia(&workflow);
        assert!(result.is_ok());
        let code = result.unwrap();
        assert!(code.contains("CSV.read"));
        assert!(code.contains("/test/data.csv"));
    }
}
