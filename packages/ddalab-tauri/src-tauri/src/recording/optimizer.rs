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
            log::debug!("[OPTIMIZER] Running pass: {}", pass.name());
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
                log::debug!("[OPTIMIZER] Running pass: {}", pass.name());
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

        // Find the index of the last RunDDAAnalysis action
        let last_analysis_idx = nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| matches!(n.action, WorkflowAction::RunDDAAnalysis { .. }))
            .map(|(idx, _)| idx)
            .last();

        // If no analysis exists, keep everything (might be for visualization only)
        let Some(last_analysis_idx) = last_analysis_idx else {
            return Ok(workflow.clone());
        };

        // Mark setup actions AFTER the last analysis as dead code
        // These are actions that were recorded out of order due to async timing
        for (idx, node) in nodes.iter().enumerate() {
            if idx > last_analysis_idx {
                match &node.action {
                    // Setup actions that should come before analysis
                    WorkflowAction::LoadFile { .. }
                    | WorkflowAction::SelectChannels { .. }
                    | WorkflowAction::DeselectChannels { .. }
                    | WorkflowAction::SelectAllChannels
                    | WorkflowAction::ClearChannelSelection
                    | WorkflowAction::SelectDDAVariants { .. }
                    | WorkflowAction::SetDDAParameters { .. }
                    | WorkflowAction::SetDelayList { .. }
                    | WorkflowAction::SetModelParameters { .. }
                    | WorkflowAction::SetTimeWindow { .. }
                    | WorkflowAction::SetChunkWindow { .. } => {
                        skip_nodes.insert(node.id.clone());
                    }
                    _ => {}
                }
            }
        }

        // Remove duplicate LoadFile actions (keep only the last one before analysis)
        let mut last_load_file: Option<(String, String)> = None; // (node_id, path)
        for (idx, node) in nodes.iter().enumerate() {
            if idx > last_analysis_idx {
                break;
            }
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

        // Remove duplicate SelectDDAVariants (keep only the last one before analysis)
        let mut last_variants_node: Option<String> = None;
        for (idx, node) in nodes.iter().enumerate() {
            if idx > last_analysis_idx {
                break;
            }
            match &node.action {
                WorkflowAction::SelectDDAVariants { .. } => {
                    if let Some(prev_id) = &last_variants_node {
                        skip_nodes.insert(prev_id.clone());
                    }
                    last_variants_node = Some(node.id.clone());
                }
                WorkflowAction::RunDDAAnalysis { .. } => {
                    // Analysis uses variants, reset tracking
                    last_variants_node = None;
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

/// Ensures actions are ordered correctly based on timestamps
/// This is the final pass that establishes the canonical order for code generation
pub struct DependencyAwareOrderingPass;

impl OptimizationPass for DependencyAwareOrderingPass {
    fn name(&self) -> &str {
        "DependencyAwareOrdering"
    }

    fn optimize(&self, workflow: &WorkflowGraph) -> anyhow::Result<WorkflowGraph> {
        let mut optimized = WorkflowGraph::new(workflow.metadata.name.clone());
        optimized.metadata = workflow.metadata.clone();

        // Get all nodes and sort by (timestamp, sequence) for stable ordering
        // Sequence breaks ties when timestamps are identical (within same millisecond)
        let mut nodes: Vec<_> = workflow.get_all_nodes().into_iter().cloned().collect();
        nodes.sort_by(|a, b| {
            a.timestamp
                .cmp(&b.timestamp)
                .then_with(|| a.sequence.cmp(&b.sequence))
        });

        // Renumber nodes sequentially to reflect the correct order
        let mut prev_node_id: Option<String> = None;
        for (idx, mut node) in nodes.into_iter().enumerate() {
            let new_id = format!("action_{}", idx);
            node.id = new_id.clone();
            optimized.add_node(node)?;

            // Create sequential edge from previous node
            if let Some(ref prev_id) = prev_node_id {
                optimized.add_edge(super::actions::WorkflowEdge {
                    source: prev_id.clone(),
                    target: new_id.clone(),
                    dependency_type: super::actions::DependencyType::OrderDependency,
                })?;
            }

            prev_node_id = Some(new_id);
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
        let all_nodes = optimized.get_all_nodes();
        let param_nodes: Vec<_> = all_nodes
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
        let all_nodes = optimized.get_all_nodes();
        let select_nodes: Vec<_> = all_nodes
            .iter()
            .filter(|n| matches!(n.action, WorkflowAction::SelectChannels { .. }))
            .collect();

        assert_eq!(select_nodes.len(), 1);

        if let WorkflowAction::SelectChannels { channel_indices } = &select_nodes[0].action {
            assert_eq!(channel_indices, &vec![0, 2, 4]);
        }
    }

    #[test]
    fn test_dead_code_elimination_removes_post_analysis_setup() {
        let mut workflow = WorkflowGraph::new("test".to_string());

        // Setup before analysis (should be kept)
        workflow
            .add_node(WorkflowNode::new(
                "load1".to_string(),
                WorkflowAction::LoadFile {
                    path: "/test/file.edf".to_string(),
                    file_type: FileType::EDF,
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "params".to_string(),
                WorkflowAction::SetDDAParameters {
                    window_length: 128,
                    window_step: 10,
                    ct_window_length: None,
                    ct_window_step: None,
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "variants1".to_string(),
                WorkflowAction::SelectDDAVariants {
                    variants: vec!["single_timeseries".to_string()],
                },
            ))
            .unwrap();

        // The analysis
        workflow
            .add_node(WorkflowNode::new(
                "run".to_string(),
                WorkflowAction::RunDDAAnalysis {
                    input_id: "test".to_string(),
                    channel_selection: vec![0, 1, 2],
                    ct_channel_pairs: None,
                    cd_channel_pairs: None,
                },
            ))
            .unwrap();

        // Setup actions AFTER analysis (should be removed - recorded out of order)
        workflow
            .add_node(WorkflowNode::new(
                "variants2".to_string(),
                WorkflowAction::SelectDDAVariants {
                    variants: vec!["single_timeseries".to_string()],
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "load2".to_string(),
                WorkflowAction::LoadFile {
                    path: "/test/file.edf".to_string(),
                    file_type: FileType::EDF,
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "select_post".to_string(),
                WorkflowAction::SelectChannels {
                    channel_indices: vec![1, 2, 3],
                },
            ))
            .unwrap();

        let pass = DeadCodeEliminationPass;
        let optimized = pass.optimize(&workflow).unwrap();

        // Should have removed the post-analysis setup actions
        let node_ids: Vec<String> = optimized
            .get_all_nodes()
            .iter()
            .map(|n| n.id.clone())
            .collect();

        // The 4 actions before/including analysis should remain
        assert!(node_ids.contains(&"load1".to_string()));
        assert!(node_ids.contains(&"params".to_string()));
        assert!(node_ids.contains(&"variants1".to_string()));
        assert!(node_ids.contains(&"run".to_string()));

        // The 3 post-analysis setup actions should be removed
        assert!(!node_ids.contains(&"variants2".to_string()));
        assert!(!node_ids.contains(&"load2".to_string()));
        assert!(!node_ids.contains(&"select_post".to_string()));

        assert_eq!(optimized.node_count(), 4);
    }

    #[test]
    fn test_dead_code_elimination_removes_duplicate_variants() {
        let mut workflow = WorkflowGraph::new("test".to_string());

        // Multiple SelectDDAVariants before analysis - only keep last
        workflow
            .add_node(WorkflowNode::new(
                "v1".to_string(),
                WorkflowAction::SelectDDAVariants {
                    variants: vec!["variant_a".to_string()],
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "v2".to_string(),
                WorkflowAction::SelectDDAVariants {
                    variants: vec!["variant_b".to_string()],
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "v3".to_string(),
                WorkflowAction::SelectDDAVariants {
                    variants: vec!["single_timeseries".to_string()],
                },
            ))
            .unwrap();

        workflow
            .add_node(WorkflowNode::new(
                "run".to_string(),
                WorkflowAction::RunDDAAnalysis {
                    input_id: "test".to_string(),
                    channel_selection: vec![0, 1],
                    ct_channel_pairs: None,
                    cd_channel_pairs: None,
                },
            ))
            .unwrap();

        let pass = DeadCodeEliminationPass;
        let optimized = pass.optimize(&workflow).unwrap();

        // Should have only v3 (the last variants selection) and run
        let all_nodes = optimized.get_all_nodes();
        let variant_nodes: Vec<_> = all_nodes
            .iter()
            .filter(|n| matches!(n.action, WorkflowAction::SelectDDAVariants { .. }))
            .collect();

        assert_eq!(variant_nodes.len(), 1);
        assert_eq!(variant_nodes[0].id, "v3");
    }
}
