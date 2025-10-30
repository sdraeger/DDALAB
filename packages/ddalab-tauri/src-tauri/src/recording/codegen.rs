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
                lag,
                dimension,
                window_size,
                window_offset,
            } => {
                format!(
                    "dda_params = {{\n        'lag': {},\n        'dimension': {},\n        'window_size': {},\n        'window_offset': {}\n    }}",
                    lag, dimension, window_size, window_offset
                )
            }
            WorkflowAction::RunDDAAnalysis {
                input_id: _,
                channel_selection,
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
            },
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
                lag,
                dimension,
                window_size,
                window_offset,
            } => {
                format!(
                    "dda_params = DDAParameters(\n    lag={},\n    dimension={},\n    window_size={},\n    window_offset={}\n)",
                    lag, dimension, window_size, window_offset
                )
            }
            WorkflowAction::RunDDAAnalysis {
                input_id: _,
                channel_selection,
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
            },
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
