use super::actions::{WorkflowAction, WorkflowNode};
use super::workflow::WorkflowGraph;
use std::collections::HashMap;

/// Trait for workflow optimization passes
/// Each pass transforms a workflow graph to improve code generation quality
pub trait OptimizationPass {
    fn name(&self) -> &str;
    fn optimize(&self, workflow: &WorkflowGraph) -> anyhow::Result<WorkflowGraph>;
}

/// Main optimizer that applies multiple optimization passes
pub struct WorkflowOptimizer {
    passes: Vec<Box<dyn OptimizationPass>>,
}

impl WorkflowOptimizer {
    pub fn new() -> Self {
        Self {
            passes: vec![
                Box::new(ParameterCoalescingPass),
                Box::new(DeadCodeEliminationPass),
                Box::new(ChannelSelectionSimplificationPass),
                Box::new(DependencyAwareOrderingPass),
            ],
        }
    }

    /// Apply all optimization passes to a workflow
    pub fn optimize(&self, workflow: &WorkflowGraph) -> anyhow::Result<WorkflowGraph> {
        let mut optimized = workflow.clone();

        for pass in &self.passes {
            println!("[OPTIMIZER] Running pass: {}", pass.name());
            optimized = pass.optimize(&optimized)?;
        }

        Ok(optimized)
    }

    /// Apply specific passes by name
    pub fn optimize_with_passes(
        &self,
        workflow: &WorkflowGraph,
        pass_names: &[&str],
    ) -> anyhow::Result<WorkflowGraph> {
        let mut optimized = workflow.clone();

        for pass in &self.passes {
            if pass_names.contains(&pass.name()) {
                println!("[OPTIMIZER] Running pass: {}", pass.name());
                optimized = pass.optimize(&optimized)?;
            }
        }

        Ok(optimized)
    }
}

impl Default for WorkflowOptimizer {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Pass 1: Parameter Coalescing
// ============================================================================

/// Combines multiple SetDDAParameters actions into a single action with final values
pub struct ParameterCoalescingPass;

impl OptimizationPass for ParameterCoalescingPass {
    fn name(&self) -> &str {
        "ParameterCoalescing"
    }

    fn optimize(&self, workflow: &WorkflowGraph) -> anyhow::Result<WorkflowGraph> {
        let mut optimized = WorkflowGraph::new(workflow.metadata.name.clone());
        optimized.metadata = workflow.metadata.clone();

        let nodes = workflow.get_all_nodes();
        let mut skip_nodes = std::collections::HashSet::new();

        // Track latest DDA parameter values
        let mut final_window_length: Option<usize> = None;
        let mut final_window_step: Option<usize> = None;
        let mut final_ct_window_length: Option<Option<usize>> = None;
        let mut final_ct_window_step: Option<Option<usize>> = None;
        let mut last_dda_param_node_id: Option<String> = None;

        // First pass: collect all DDA parameter changes
        for node in &nodes {
            if let WorkflowAction::SetDDAParameters {
                window_length,
                window_step,
                ct_window_length,
                ct_window_step,
            } = &node.action
            {
                final_window_length = Some(*window_length);
                final_window_step = Some(*window_step);
                final_ct_window_length = Some(*ct_window_length);
                final_ct_window_step = Some(*ct_window_step);
                last_dda_param_node_id = Some(node.id.clone());
                skip_nodes.insert(node.id.clone());
            }
        }

        // Second pass: rebuild graph with coalesced parameters
        for node in &nodes {
            if skip_nodes.contains(&node.id) {
                // If this is the last DDA parameter node, emit coalesced version
                if Some(&node.id) == last_dda_param_node_id.as_ref() {
                    let coalesced_node = WorkflowNode::new(
                        node.id.clone(),
                        WorkflowAction::SetDDAParameters {
                            window_length: final_window_length.unwrap(),
                            window_step: final_window_step.unwrap(),
                            ct_window_length: final_ct_window_length.unwrap(),
                            ct_window_step: final_ct_window_step.unwrap(),
                        },
                    );
                    optimized.add_node(coalesced_node)?;
                }
                // Skip all other DDA parameter nodes
            } else {
                optimized.add_node((*node).clone())?;
            }
        }

        // Copy edges (will be updated by dependency ordering pass)
        for edge in workflow.get_all_edges() {
            if optimized.get_node(&edge.source).is_some()
                && optimized.get_node(&edge.target).is_some()
            {
                optimized.add_edge(edge)?;
            }
        }

        Ok(optimized)
    }
}

// ============================================================================
// Pass 2: Dead Code Elimination
// ============================================================================

/// Removes actions that have no effect on the final analysis
pub struct DeadCodeEliminationPass;

impl OptimizationPass for DeadCodeEliminationPass {
    fn name(&self) -> &str {
        "DeadCodeElimination"
    }

    fn optimize(&self, workflow: &WorkflowGraph) -> anyhow::Result<WorkflowGraph> {
        let mut optimized = WorkflowGraph::new(workflow.metadata.name.clone());
        optimized.metadata = workflow.metadata.clone();

        let nodes = workflow.get_all_nodes();
        let mut skip_nodes = std::collections::HashSet::new();

        // Track if we ever run an analysis
        let has_analysis = nodes
            .iter()
            .any(|n| matches!(n.action, WorkflowAction::RunDDAAnalysis { .. }));

        if !has_analysis {
            // No analysis = keep everything (might be for visualization only)
            return Ok(workflow.clone());
        }

        // Remove actions that are overwritten before use
        // Example: LoadFile → LoadFile (same path) → Analysis
        //          Only keep the last LoadFile

        let mut last_load_file: Option<(String, String)> = None; // (node_id, path)

        for node in &nodes {
            match &node.action {
                WorkflowAction::LoadFile { path, .. } => {
                    if let Some((prev_id, prev_path)) = &last_load_file {
                        if prev_path == path {
                            // Same file loaded again, mark previous as dead
                            skip_nodes.insert(prev_id.clone());
                        }
                    }
                    last_load_file = Some((node.id.clone(), path.clone()));
                }
                WorkflowAction::RunDDAAnalysis { .. } => {
                    // Analysis uses whatever was loaded, so stop tracking
                    last_load_file = None;
                }
                _ => {}
            }
        }

        // Rebuild graph without dead nodes
        for node in &nodes {
            if !skip_nodes.contains(&node.id) {
                optimized.add_node((*node).clone())?;
            }
        }

        // Copy relevant edges
        for edge in workflow.get_all_edges() {
            if optimized.get_node(&edge.source).is_some()
                && optimized.get_node(&edge.target).is_some()
            {
                optimized.add_edge(edge)?;
            }
        }

        Ok(optimized)
    }
}

// ============================================================================
// Pass 3: Channel Selection Simplification
// ============================================================================

/// Simplifies channel selection actions
/// Example: Select[1,2] → Select[3,4] → Deselect[2,3] becomes Select[1,4]
pub struct ChannelSelectionSimplificationPass;

impl OptimizationPass for ChannelSelectionSimplificationPass {
    fn name(&self) -> &str {
        "ChannelSelectionSimplification"
    }

    fn optimize(&self, workflow: &WorkflowGraph) -> anyhow::Result<WorkflowGraph> {
        let mut optimized = WorkflowGraph::new(workflow.metadata.name.clone());
        optimized.metadata = workflow.metadata.clone();

        let nodes = workflow.get_all_nodes();
        let mut skip_nodes = std::collections::HashSet::new();

        // Track final channel selection state
        let mut selected_channels: std::collections::HashSet<usize> =
            std::collections::HashSet::new();
        let mut last_selection_node_id: Option<String> = None;
        let mut selection_sequence_started = false;

        for node in nodes {
            match &node.action {
                WorkflowAction::SelectChannels { channel_indices } => {
                    for &ch in channel_indices {
                        selected_channels.insert(ch);
                    }
                    last_selection_node_id = Some(node.id.clone());
                    skip_nodes.insert(node.id.clone());
                    selection_sequence_started = true;
                }
                WorkflowAction::DeselectChannels { channel_indices } => {
                    for &ch in channel_indices {
                        selected_channels.remove(&ch);
                    }
                    last_selection_node_id = Some(node.id.clone());
                    skip_nodes.insert(node.id.clone());
                    selection_sequence_started = true;
                }
                WorkflowAction::SelectAllChannels => {
                    // Can't simplify without knowing total channel count
                    // Keep as-is
                    selection_sequence_started = false;
                }
                WorkflowAction::ClearChannelSelection => {
                    selected_channels.clear();
                    last_selection_node_id = Some(node.id.clone());
                    skip_nodes.insert(node.id.clone());
                    selection_sequence_started = true;
                }
                WorkflowAction::RunDDAAnalysis { .. } => {
                    // Emit simplified selection before analysis
                    if selection_sequence_started {
                        if let Some(ref last_id) = last_selection_node_id {
                            let mut final_selection: Vec<usize> =
                                selected_channels.iter().copied().collect();
                            final_selection.sort();

                            if !final_selection.is_empty() {
                                let simplified = WorkflowNode::new(
                                    last_id.clone(),
                                    WorkflowAction::SelectChannels {
                                        channel_indices: final_selection,
                                    },
                                );
                                optimized.add_node(simplified)?;
                            }
                        }
                        selection_sequence_started = false;
                    }
                    optimized.add_node(node.clone())?;
                }
                _ => {
                    // Non-channel action, keep as-is
                    if !skip_nodes.contains(&node.id) {
                        optimized.add_node(node.clone())?;
                    }
                }
            }
        }

        // If workflow ends without analysis, emit final selection
        if selection_sequence_started {
            if let Some(ref last_id) = last_selection_node_id {
                let mut final_selection: Vec<usize> = selected_channels.iter().copied().collect();
                final_selection.sort();

                if !final_selection.is_empty() {
                    let simplified = WorkflowNode::new(
                        last_id.clone(),
                        WorkflowAction::SelectChannels {
                            channel_indices: final_selection,
                        },
                    );
                    optimized.add_node(simplified)?;
                }
            }
        }

        // Copy relevant edges
        for edge in workflow.get_all_edges() {
            if optimized.get_node(&edge.source).is_some()
                && optimized.get_node(&edge.target).is_some()
            {
                optimized.add_edge(edge)?;
            }
        }

        Ok(optimized)
    }
}

// ============================================================================
// Pass 4: Dependency-Aware Ordering
// ============================================================================

/// Ensures actions are ordered correctly based on dependencies
pub struct DependencyAwareOrderingPass;

impl OptimizationPass for DependencyAwareOrderingPass {
    fn name(&self) -> &str {
        "DependencyAwareOrdering"
    }

    fn optimize(&self, workflow: &WorkflowGraph) -> anyhow::Result<WorkflowGraph> {
        // Get topological order
        let ordered_ids = workflow.get_topological_order()?;

        let mut optimized = WorkflowGraph::new(workflow.metadata.name.clone());
        optimized.metadata = workflow.metadata.clone();

        // Add nodes in topological order
        for id in &ordered_ids {
            if let Some(node) = workflow.get_node(id) {
                optimized.add_node(node.clone())?;
            }
        }

        // Rebuild edges based on implicit dependencies
        for i in 0..ordered_ids.len() {
            if i + 1 < ordered_ids.len() {
                let source = &ordered_ids[i];
                let target = &ordered_ids[i + 1];

                // Add sequential edge
                optimized.add_edge(super::actions::WorkflowEdge {
                    source: source.clone(),
                    target: target.clone(),
                    dependency_type: super::actions::DependencyType::OrderDependency,
                })?;
            }
        }

        Ok(optimized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recording::actions::FileType;

    #[test]
    fn test_parameter_coalescing() {
        let mut workflow = WorkflowGraph::new("test".to_string());

        // Add multiple SetDDAParameters actions
        workflow
            .add_node(WorkflowNode::new(
                "p1".to_string(),
                WorkflowAction::SetDDAParameters {
                    window_length: 1000,
                    window_step: 100,
                    ct_window_length: None,
                    ct_window_step: None,
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "p2".to_string(),
                WorkflowAction::SetDDAParameters {
                    window_length: 2000,
                    window_step: 200,
                    ct_window_length: Some(500),
                    ct_window_step: Some(50),
                },
            ))
            .unwrap();

        let pass = ParameterCoalescingPass;
        let optimized = pass.optimize(&workflow).unwrap();

        // Should have only 1 SetDDAParameters with final values
        let param_nodes: Vec<_> = optimized
            .get_all_nodes()
            .iter()
            .filter(|n| matches!(n.action, WorkflowAction::SetDDAParameters { .. }))
            .collect();

        assert_eq!(param_nodes.len(), 1);

        if let WorkflowAction::SetDDAParameters {
            window_length,
            window_step,
            ..
        } = param_nodes[0].action
        {
            assert_eq!(window_length, 2000);
            assert_eq!(window_step, 200);
        }
    }

    #[test]
    fn test_channel_selection_simplification() {
        let mut workflow = WorkflowGraph::new("test".to_string());

        workflow
            .add_node(WorkflowNode::new(
                "s1".to_string(),
                WorkflowAction::SelectChannels {
                    channel_indices: vec![0, 1, 2],
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "s2".to_string(),
                WorkflowAction::SelectChannels {
                    channel_indices: vec![3, 4],
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "d1".to_string(),
                WorkflowAction::DeselectChannels {
                    channel_indices: vec![1, 3],
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "run".to_string(),
                WorkflowAction::RunDDAAnalysis {
                    input_id: "test".to_string(),
                    channel_selection: vec![0, 2, 4],
                    ct_channel_pairs: None,
                    cd_channel_pairs: None,
                },
            ))
            .unwrap();

        let pass = ChannelSelectionSimplificationPass;
        let optimized = pass.optimize(&workflow).unwrap();

        // Should have only 1 SelectChannels with final state: [0, 2, 4]
        let select_nodes: Vec<_> = optimized
            .get_all_nodes()
            .iter()
            .filter(|n| matches!(n.action, WorkflowAction::SelectChannels { .. }))
            .collect();

        assert_eq!(select_nodes.len(), 1);

        if let WorkflowAction::SelectChannels { channel_indices } = &select_nodes[0].action {
            assert_eq!(channel_indices, &vec![0, 2, 4]);
        }
    }
}
