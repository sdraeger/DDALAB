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
                FileType::EDF => format!("data = load_edf_file('{}')", path),
                FileType::ASCII => format!("data = np.loadtxt('{}')", path),
                FileType::CSV => format!("data = pd.read_csv('{}')", path),
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
                format!(
                    "result = run_dda_analysis(data, channels={}, **dda_params)",
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
                FileType::EDF => format!("data = load_edf(\"{}\")", path),
                FileType::ASCII => format!("data = readdlm(\"{}\")", path),
                FileType::CSV => format!("data = CSV.read(\"{}\", DataFrame)", path),
            },
            WorkflowAction::SetDDAParameters {
                window_length,
                window_step,
                ct_window_length,
                ct_window_step,
            } => {
                let mut params = format!(
                    "dda_params = DDAParameters(\n    window_length={},\n    window_step={}",
                    window_length, window_step
                );
                if let Some(ct_wl) = ct_window_length {
                    params.push_str(&format!(",\n    ct_window_length={}", ct_wl));
                }
                if let Some(ct_ws) = ct_window_step {
                    params.push_str(&format!(",\n    ct_window_step={}", ct_ws));
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
                    "result = run_dda_analysis(data, channels={}, dda_params)",
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

                match plot_type {
                    PlotType::Heatmap => format!("heatmap(result{})", title),
                    PlotType::TimeSeries => format!("plot(result{})", title),
                    PlotType::StatisticalSummary => format!("plot_statistics(result{})", title),
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
                    format!("data = bandpass_filter(data, {}, {})", low_freq, high_freq)
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
                FileType::EDF => format!("let data = read_edf_file(\"{}\")?;", path),
                FileType::ASCII => format!("let data = read_ascii_file(\"{}\")?;", path),
                FileType::CSV => format!("let data = read_csv_file(\"{}\")?;", path),
            },
            WorkflowAction::SetDDAParameters {
                window_length,
                window_step,
                ct_window_length,
                ct_window_step,
            } => {
                let mut params = format!(
                    "let mut dda_params = DDAParams {{\n        window_length: {},\n        window_step: {},",
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
                format!(
                    "let result = run_dda_analysis(&data, &{}, &dda_params)?;",
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
                format!("let dda_variants = {};", format_rust_string_array(variants))
            }
            WorkflowAction::SetDelayList { delays } => {
                format!("let delay_list = {};", format_rust_array_i32(delays))
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
"""

import numpy as np
import pandas as pd
import scipy.io
import scipy.signal as signal
import matplotlib.pyplot as plt

def load_edf_file(path):
    """Load EDF file and return data matrix"""
    # TODO: Implement EDF loading
    pass

def run_dda_analysis(data, channels, lag, dimension, window_size, window_offset):
    """Run DDA analysis on data"""
    # TODO: Implement DDA analysis call
    pass

def plot_heatmap(result, title=None, cmap='viridis', normalize=False):
    """Generate heatmap visualization"""
    if normalize:
        result = (result - result.min()) / (result.max() - result.min())
    plt.imshow(result, cmap=cmap)
    if title:
        plt.title(title)
    plt.colorbar()
    plt.show()

def plot_timeseries(result, title=None):
    """Generate time series visualization"""
    plt.plot(result)
    if title:
        plt.title(title)
    plt.show()

def plot_statistics(result, title=None):
    """Generate statistical summary visualization"""
    # TODO: Implement statistics visualization
    pass

def bandpass_filter(data, low_freq, high_freq):
    """Apply bandpass filter to data"""
    # TODO: Implement bandpass filter
    pass

def main():
    """Execute workflow"""
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
"""

using CSV
using DataFrames
using JSON
using MAT
using DelimitedFiles
using Statistics
using Plots

struct DDAParameters
    lag::Int
    dimension::Int
    window_size::Int
    window_offset::Int
end

function load_edf(path::String)
    """Load EDF file and return data matrix"""
    # TODO: Implement EDF loading
end

function run_dda_analysis(data, channels, params::DDAParameters)
    """Run DDA analysis on data"""
    # TODO: Implement DDA analysis call
end

function plot_statistics(result; title=nothing)
    """Generate statistical summary visualization"""
    # TODO: Implement statistics visualization
end

function bandpass_filter(data, low_freq, high_freq)
    """Apply bandpass filter to data"""
    # TODO: Implement bandpass filter
end

function main()
    """Execute workflow"""
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

use anyhow::Result;
use std::path::Path;

fn main() -> Result<()> {
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
        assert!(code.contains("load_edf_file"));
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
