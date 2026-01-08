use anyhow::{anyhow, Result};
use petgraph::algo::{is_cyclic_directed, toposort};
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::actions::{DependencyType, WorkflowEdge, WorkflowNode};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowGraph {
    #[serde(skip)]
    graph: DiGraph<WorkflowNode, DependencyType>,
    #[serde(skip)]
    node_map: HashMap<String, NodeIndex>,
    pub metadata: WorkflowMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowMetadata {
    pub name: String,
    pub description: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub modified_at: chrono::DateTime<chrono::Utc>,
    pub version: String,
}

impl WorkflowGraph {
    pub fn new(name: String) -> Self {
        Self {
            graph: DiGraph::new(),
            node_map: HashMap::new(),
            metadata: WorkflowMetadata {
                name,
                description: None,
                created_at: chrono::Utc::now(),
                modified_at: chrono::Utc::now(),
                version: "1.0.0".to_string(),
            },
        }
    }

    pub fn add_node(&mut self, node: WorkflowNode) -> Result<String> {
        let node_id = node.id.clone();

        if self.node_map.contains_key(&node_id) {
            return Err(anyhow!("Node with id {} already exists", node_id));
        }

        let index = self.graph.add_node(node);
        self.node_map.insert(node_id.clone(), index);
        self.metadata.modified_at = chrono::Utc::now();

        Ok(node_id)
    }

    pub fn add_edge(&mut self, edge: WorkflowEdge) -> Result<()> {
        let source_idx = self
            .node_map
            .get(&edge.source)
            .ok_or_else(|| anyhow!("Source node {} not found", edge.source))?;
        let target_idx = self
            .node_map
            .get(&edge.target)
            .ok_or_else(|| anyhow!("Target node {} not found", edge.target))?;

        self.graph
            .add_edge(*source_idx, *target_idx, edge.dependency_type);

        // Check for cycles after adding edge
        if is_cyclic_directed(&self.graph) {
            // Remove the edge we just added
            if let Some(edge_idx) = self.graph.find_edge(*source_idx, *target_idx) {
                self.graph.remove_edge(edge_idx);
            }
            return Err(anyhow!("Adding edge would create a cycle"));
        }

        self.metadata.modified_at = chrono::Utc::now();
        Ok(())
    }

    pub fn remove_node(&mut self, node_id: &str) -> Result<()> {
        let index = self
            .node_map
            .remove(node_id)
            .ok_or_else(|| anyhow!("Node {} not found", node_id))?;

        self.graph.remove_node(index);
        self.metadata.modified_at = chrono::Utc::now();

        Ok(())
    }

    pub fn get_node(&self, node_id: &str) -> Option<&WorkflowNode> {
        self.node_map
            .get(node_id)
            .and_then(|idx| self.graph.node_weight(*idx))
    }

    pub fn get_topological_order(&self) -> Result<Vec<String>> {
        let sorted_indices =
            toposort(&self.graph, None).map_err(|_| anyhow!("Graph contains cycles"))?;

        Ok(sorted_indices
            .into_iter()
            .filter_map(|idx| self.graph.node_weight(idx).map(|n| n.id.clone()))
            .collect())
    }

    pub fn get_dependencies(&self, node_id: &str) -> Result<Vec<(String, DependencyType)>> {
        let index = self
            .node_map
            .get(node_id)
            .ok_or_else(|| anyhow!("Node {} not found", node_id))?;

        Ok(self
            .graph
            .edges_directed(*index, petgraph::Direction::Incoming)
            .filter_map(|edge| {
                self.graph
                    .node_weight(edge.source())
                    .map(|n| (n.id.clone(), edge.weight().clone()))
            })
            .collect())
    }

    pub fn get_dependents(&self, node_id: &str) -> Result<Vec<(String, DependencyType)>> {
        let index = self
            .node_map
            .get(node_id)
            .ok_or_else(|| anyhow!("Node {} not found", node_id))?;

        Ok(self
            .graph
            .edges_directed(*index, petgraph::Direction::Outgoing)
            .filter_map(|edge| {
                self.graph
                    .node_weight(edge.target())
                    .map(|n| (n.id.clone(), edge.weight().clone()))
            })
            .collect())
    }

    pub fn validate(&self) -> Result<()> {
        // Check for cycles
        if is_cyclic_directed(&self.graph) {
            return Err(anyhow!("Workflow contains cycles"));
        }

        // Check that all nodes are reachable
        if self.graph.node_count() > 0 {
            let topo_order = self.get_topological_order()?;
            if topo_order.len() != self.graph.node_count() {
                return Err(anyhow!("Not all nodes are reachable"));
            }
        }

        Ok(())
    }

    pub fn get_all_nodes(&self) -> Vec<&WorkflowNode> {
        self.graph.node_weights().collect()
    }

    pub fn get_all_edges(&self) -> Vec<WorkflowEdge> {
        self.graph
            .edge_references()
            .filter_map(|edge| {
                let source = self.graph.node_weight(edge.source())?;
                let target = self.graph.node_weight(edge.target())?;
                Some(WorkflowEdge {
                    source: source.id.clone(),
                    target: target.id.clone(),
                    dependency_type: edge.weight().clone(),
                })
            })
            .collect()
    }

    pub fn clear(&mut self) {
        self.graph.clear();
        self.node_map.clear();
        self.metadata.modified_at = chrono::Utc::now();
    }

    pub fn node_count(&self) -> usize {
        self.graph.node_count()
    }

    pub fn edge_count(&self) -> usize {
        self.graph.edge_count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recording::actions::{FileType, WorkflowAction};

    #[test]
    fn test_workflow_graph_creation() {
        let graph = WorkflowGraph::new("test_workflow".to_string());
        assert_eq!(graph.node_count(), 0);
        assert_eq!(graph.edge_count(), 0);
    }

    #[test]
    fn test_add_node() {
        let mut graph = WorkflowGraph::new("test_workflow".to_string());
        let node = WorkflowNode::new(
            "node1".to_string(),
            WorkflowAction::LoadFile {
                path: "/test/file.edf".to_string(),
                file_type: FileType::EDF,
            },
        );

        let result = graph.add_node(node);
        assert!(result.is_ok());
        assert_eq!(graph.node_count(), 1);
    }

    #[test]
    fn test_add_edge() {
        let mut graph = WorkflowGraph::new("test_workflow".to_string());

        let node1 = WorkflowNode::new(
            "node1".to_string(),
            WorkflowAction::LoadFile {
                path: "/test/file.edf".to_string(),
                file_type: FileType::EDF,
            },
        );
        let node2 = WorkflowNode::new(
            "node2".to_string(),
            WorkflowAction::RunDDAAnalysis {
                input_id: "node1".to_string(),
                channel_selection: vec![0, 1, 2],
                ct_channel_pairs: None,
                cd_channel_pairs: None,
            },
        );

        graph.add_node(node1).unwrap();
        graph.add_node(node2).unwrap();

        let edge = WorkflowEdge {
            source: "node1".to_string(),
            target: "node2".to_string(),
            dependency_type: DependencyType::DataDependency,
        };

        let result = graph.add_edge(edge);
        assert!(result.is_ok());
        assert_eq!(graph.edge_count(), 1);
    }

    #[test]
    fn test_cycle_detection() {
        let mut graph = WorkflowGraph::new("test_workflow".to_string());

        let node1 = WorkflowNode::new(
            "node1".to_string(),
            WorkflowAction::LoadFile {
                path: "/test/file.edf".to_string(),
                file_type: FileType::EDF,
            },
        );
        let node2 = WorkflowNode::new(
            "node2".to_string(),
            WorkflowAction::RunDDAAnalysis {
                input_id: "node1".to_string(),
                channel_selection: vec![0, 1, 2],
                ct_channel_pairs: None,
                cd_channel_pairs: None,
            },
        );

        graph.add_node(node1).unwrap();
        graph.add_node(node2).unwrap();

        graph
            .add_edge(WorkflowEdge {
                source: "node1".to_string(),
                target: "node2".to_string(),
                dependency_type: DependencyType::DataDependency,
            })
            .unwrap();

        // Try to create a cycle
        let result = graph.add_edge(WorkflowEdge {
            source: "node2".to_string(),
            target: "node1".to_string(),
            dependency_type: DependencyType::DataDependency,
        });

        assert!(result.is_err());
    }

    #[test]
    fn test_topological_sort() {
        let mut graph = WorkflowGraph::new("test_workflow".to_string());

        let node1 = WorkflowNode::new(
            "node1".to_string(),
            WorkflowAction::LoadFile {
                path: "/test/file.edf".to_string(),
                file_type: FileType::EDF,
            },
        );
        let node2 = WorkflowNode::new(
            "node2".to_string(),
            WorkflowAction::RunDDAAnalysis {
                input_id: "node1".to_string(),
                channel_selection: vec![0, 1, 2],
                ct_channel_pairs: None,
                cd_channel_pairs: None,
            },
        );
        let node3 = WorkflowNode::new(
            "node3".to_string(),
            WorkflowAction::ExportResults {
                result_id: "node2".to_string(),
                format: crate::recording::actions::ExportFormat::CSV,
                path: "/test/output.csv".to_string(),
            },
        );

        graph.add_node(node1).unwrap();
        graph.add_node(node2).unwrap();
        graph.add_node(node3).unwrap();

        graph
            .add_edge(WorkflowEdge {
                source: "node1".to_string(),
                target: "node2".to_string(),
                dependency_type: DependencyType::DataDependency,
            })
            .unwrap();

        graph
            .add_edge(WorkflowEdge {
                source: "node2".to_string(),
                target: "node3".to_string(),
                dependency_type: DependencyType::DataDependency,
            })
            .unwrap();

        let order = graph.get_topological_order().unwrap();
        assert_eq!(order, vec!["node1", "node2", "node3"]);
    }
}
