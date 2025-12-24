use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use super::actions::{DependencyType, WorkflowAction, WorkflowEdge, WorkflowNode};
use super::workflow::WorkflowGraph;

/// A buffered action with additional context for later optimization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferedAction {
    /// The action that was performed
    pub action: WorkflowAction,
    /// When the action was performed
    pub timestamp: DateTime<Utc>,
    /// Which file was active when this action was performed
    pub active_file_id: Option<String>,
    /// Whether this action was auto-generated (vs user-initiated)
    pub auto_generated: bool,
}

impl BufferedAction {
    pub fn new(action: WorkflowAction) -> Self {
        Self {
            action,
            timestamp: Utc::now(),
            active_file_id: None,
            auto_generated: false,
        }
    }

    pub fn with_file_context(mut self, file_id: Option<String>) -> Self {
        self.active_file_id = file_id;
        self
    }

    pub fn with_auto_generated(mut self, auto: bool) -> Self {
        self.auto_generated = auto;
        self
    }
}

/// Circular buffer for recording user actions
/// Automatically manages memory by keeping only the most recent N actions
pub struct ActionBuffer {
    /// The circular buffer of actions
    buffer: VecDeque<BufferedAction>,
    /// Maximum number of actions to keep
    capacity: usize,
    /// Total number of actions ever recorded (for statistics)
    total_recorded: u64,
}

impl ActionBuffer {
    /// Default capacity: 200 actions (~50KB memory footprint)
    pub const DEFAULT_CAPACITY: usize = 200;

    /// Create a new buffer with default capacity
    pub fn new() -> Self {
        Self::with_capacity(Self::DEFAULT_CAPACITY)
    }

    /// Create a new buffer with specified capacity
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            buffer: VecDeque::with_capacity(capacity),
            capacity,
            total_recorded: 0,
        }
    }

    /// Record a new action to the buffer
    /// If buffer is full, oldest action is automatically removed
    pub fn record(&mut self, action: BufferedAction) {
        if self.buffer.len() >= self.capacity {
            self.buffer.pop_front();
        }
        self.buffer.push_back(action);
        self.total_recorded += 1;
    }

    /// Get all buffered actions in chronological order
    pub fn get_all(&self) -> Vec<BufferedAction> {
        self.buffer.iter().cloned().collect()
    }

    /// Get actions from the last N minutes
    pub fn get_last_n_minutes(&self, minutes: i64) -> Vec<BufferedAction> {
        let cutoff = Utc::now() - chrono::Duration::minutes(minutes);
        self.buffer
            .iter()
            .filter(|action| action.timestamp > cutoff)
            .cloned()
            .collect()
    }

    /// Get the last N actions
    pub fn get_last_n_actions(&self, n: usize) -> Vec<BufferedAction> {
        let start = self.buffer.len().saturating_sub(n);
        self.buffer.iter().skip(start).cloned().collect()
    }

    /// Clear all buffered actions
    pub fn clear(&mut self) {
        self.buffer.clear();
    }

    /// Get the current number of buffered actions
    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    /// Check if buffer is empty
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    /// Get total number of actions ever recorded (including evicted ones)
    pub fn total_recorded(&self) -> u64 {
        self.total_recorded
    }

    /// Convert buffered actions to a WorkflowGraph
    /// This creates a linear DAG with sequential dependencies
    pub fn to_workflow(&self, workflow_name: String) -> anyhow::Result<WorkflowGraph> {
        let mut workflow = WorkflowGraph::new(workflow_name);

        let actions = self.get_all();
        if actions.is_empty() {
            return Ok(workflow);
        }

        let mut prev_node_id: Option<String> = None;

        for (idx, buffered_action) in actions.iter().enumerate() {
            // Generate unique node ID
            let node_id = format!("action_{}", idx);

            // Create workflow node
            let mut node = WorkflowNode::new(node_id.clone(), buffered_action.action.clone());
            node.timestamp = buffered_action.timestamp;

            // Add metadata about the action
            node.metadata.tags = if buffered_action.auto_generated {
                vec!["auto-generated".to_string()]
            } else {
                vec!["user-action".to_string()]
            };

            if let Some(ref file_id) = buffered_action.active_file_id {
                node.metadata.description = Some(format!("Active file: {}", file_id));
            }

            // Add node to workflow
            workflow.add_node(node)?;

            // Create sequential dependency edge if there was a previous node
            if let Some(ref prev_id) = prev_node_id {
                let edge = WorkflowEdge {
                    source: prev_id.clone(),
                    target: node_id.clone(),
                    dependency_type: DependencyType::OrderDependency,
                };
                workflow.add_edge(edge)?;
            }

            prev_node_id = Some(node_id);
        }

        Ok(workflow)
    }

    /// Convert a subset of actions (e.g., last 5 minutes) to a WorkflowGraph
    pub fn to_workflow_from_subset(
        &self,
        actions: Vec<BufferedAction>,
        workflow_name: String,
    ) -> anyhow::Result<WorkflowGraph> {
        let mut workflow = WorkflowGraph::new(workflow_name);

        if actions.is_empty() {
            return Ok(workflow);
        }

        let mut prev_node_id: Option<String> = None;

        for (idx, buffered_action) in actions.iter().enumerate() {
            let node_id = format!("action_{}", idx);
            let mut node = WorkflowNode::new(node_id.clone(), buffered_action.action.clone());
            node.timestamp = buffered_action.timestamp;

            node.metadata.tags = if buffered_action.auto_generated {
                vec!["auto-generated".to_string()]
            } else {
                vec!["user-action".to_string()]
            };

            if let Some(ref file_id) = buffered_action.active_file_id {
                node.metadata.description = Some(format!("Active file: {}", file_id));
            }

            workflow.add_node(node)?;

            if let Some(ref prev_id) = prev_node_id {
                let edge = WorkflowEdge {
                    source: prev_id.clone(),
                    target: node_id.clone(),
                    dependency_type: DependencyType::OrderDependency,
                };
                workflow.add_edge(edge)?;
            }

            prev_node_id = Some(node_id);
        }

        Ok(workflow)
    }
}

impl Default for ActionBuffer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recording::actions::FileType;

    #[test]
    fn test_buffer_capacity() {
        let mut buffer = ActionBuffer::with_capacity(3);

        // Add 3 actions
        for i in 0..3 {
            buffer.record(BufferedAction::new(WorkflowAction::LoadFile {
                path: format!("file{}.edf", i),
                file_type: FileType::EDF,
            }));
        }

        assert_eq!(buffer.len(), 3);

        // Add 4th action - should evict first
        buffer.record(BufferedAction::new(WorkflowAction::LoadFile {
            path: "file3.edf".to_string(),
            file_type: FileType::EDF,
        }));

        assert_eq!(buffer.len(), 3);
        assert_eq!(buffer.total_recorded(), 4);
    }

    #[test]
    fn test_get_last_n_actions() {
        let mut buffer = ActionBuffer::new();

        for i in 0..10 {
            buffer.record(BufferedAction::new(WorkflowAction::LoadFile {
                path: format!("file{}.edf", i),
                file_type: FileType::EDF,
            }));
        }

        let last_3 = buffer.get_last_n_actions(3);
        assert_eq!(last_3.len(), 3);
    }

    #[test]
    fn test_to_workflow() {
        let mut buffer = ActionBuffer::new();

        buffer.record(BufferedAction::new(WorkflowAction::LoadFile {
            path: "data.edf".to_string(),
            file_type: FileType::EDF,
        }));

        buffer.record(BufferedAction::new(WorkflowAction::SelectChannels {
            channel_indices: vec![0, 1, 2],
        }));

        buffer.record(BufferedAction::new(WorkflowAction::SetTimeWindow {
            start: 0.0,
            end: 10.0,
        }));

        let workflow = buffer.to_workflow("test_session".to_string()).unwrap();

        assert_eq!(workflow.node_count(), 3);
        assert_eq!(workflow.edge_count(), 2); // 2 sequential edges

        // Verify topological order
        let order = workflow.get_topological_order().unwrap();
        assert_eq!(order.len(), 3);
    }

    #[test]
    fn test_clear() {
        let mut buffer = ActionBuffer::new();

        buffer.record(BufferedAction::new(WorkflowAction::LoadFile {
            path: "data.edf".to_string(),
            file_type: FileType::EDF,
        }));

        assert_eq!(buffer.len(), 1);

        buffer.clear();

        assert_eq!(buffer.len(), 0);
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_file_context() {
        let mut buffer = ActionBuffer::new();

        let action = BufferedAction::new(WorkflowAction::SelectChannels {
            channel_indices: vec![0, 1],
        })
        .with_file_context(Some("file_123".to_string()));

        buffer.record(action);

        let actions = buffer.get_all();
        assert_eq!(actions[0].active_file_id, Some("file_123".to_string()));
    }

    #[test]
    fn test_auto_generated_flag() {
        let mut buffer = ActionBuffer::new();

        let action =
            BufferedAction::new(WorkflowAction::SelectAllChannels).with_auto_generated(true);

        buffer.record(action);

        let workflow = buffer.to_workflow("test".to_string()).unwrap();
        let nodes = workflow.get_all_nodes();

        assert!(nodes[0]
            .metadata
            .tags
            .contains(&"auto-generated".to_string()));
    }
}
