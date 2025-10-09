use tauri::State;
use parking_lot::RwLock;
use serde::{Serialize, Deserialize};
use std::sync::Arc;

use super::workflow::WorkflowGraph;
use super::actions::{WorkflowNode, WorkflowEdge, WorkflowAction};
use super::codegen::CodeGenerator;

pub struct WorkflowState {
    workflow: Arc<RwLock<WorkflowGraph>>,
    code_generator: CodeGenerator,
    last_node_id: Arc<RwLock<Option<String>>>,
}

impl WorkflowState {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            workflow: Arc::new(RwLock::new(WorkflowGraph::new("session".to_string()))),
            code_generator: CodeGenerator::new()?,
            last_node_id: Arc::new(RwLock::new(None)),
        })
    }

    pub fn new_workflow(&self, name: String) {
        let mut workflow = self.workflow.write();
        *workflow = WorkflowGraph::new(name);
        // Reset last node ID when creating new workflow
        *self.last_node_id.write() = None;
    }

    pub fn get_workflow(&self) -> WorkflowGraph {
        self.workflow.read().clone()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowInfo {
    pub node_count: usize,
    pub edge_count: usize,
    pub metadata: super::workflow::WorkflowMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub id: String,
    pub action: WorkflowAction,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub dependencies: Vec<String>,
    pub dependents: Vec<String>,
}

#[tauri::command]
pub async fn workflow_new(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
    name: String,
) -> Result<(), String> {
    let workflow_state = state.read();
    workflow_state.new_workflow(name);
    Ok(())
}

#[tauri::command]
pub async fn workflow_add_node(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
    node: WorkflowNode,
) -> Result<String, String> {
    let workflow_state = state.read();
    let mut workflow = workflow_state.workflow.write();
    workflow.add_node(node).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workflow_add_edge(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
    edge: WorkflowEdge,
) -> Result<(), String> {
    let workflow_state = state.read();
    let mut workflow = workflow_state.workflow.write();
    workflow.add_edge(edge).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workflow_remove_node(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
    node_id: String,
) -> Result<(), String> {
    let workflow_state = state.read();
    let mut workflow = workflow_state.workflow.write();
    workflow.remove_node(&node_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workflow_get_node(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
    node_id: String,
) -> Result<Option<NodeInfo>, String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();

    if let Some(node) = workflow.get_node(&node_id) {
        let dependencies = workflow.get_dependencies(&node_id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|(id, _)| id)
            .collect();

        let dependents = workflow.get_dependents(&node_id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|(id, _)| id)
            .collect();

        Ok(Some(NodeInfo {
            id: node.id.clone(),
            action: node.action.clone(),
            timestamp: node.timestamp,
            dependencies,
            dependents,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn workflow_get_info(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<WorkflowInfo, String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();

    Ok(WorkflowInfo {
        node_count: workflow.node_count(),
        edge_count: workflow.edge_count(),
        metadata: workflow.metadata.clone(),
    })
}

#[tauri::command]
pub async fn workflow_get_topological_order(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<Vec<String>, String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();
    workflow.get_topological_order().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workflow_validate(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<(), String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();
    workflow.validate().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workflow_generate_python(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<String, String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();
    workflow_state.code_generator.generate_python(&workflow).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workflow_generate_julia(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<String, String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();
    workflow_state.code_generator.generate_julia(&workflow).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workflow_clear(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<(), String> {
    let workflow_state = state.read();
    let mut workflow = workflow_state.workflow.write();
    workflow.clear();
    Ok(())
}

#[tauri::command]
pub async fn workflow_get_all_nodes(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<Vec<WorkflowNode>, String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();
    Ok(workflow.get_all_nodes().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn workflow_get_all_edges(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<Vec<WorkflowEdge>, String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();
    Ok(workflow.get_all_edges())
}

#[tauri::command]
pub async fn workflow_record_action(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
    action: WorkflowAction,
) -> Result<String, String> {
    let workflow_state = state.read();
    let mut workflow = workflow_state.workflow.write();

    // Generate unique node ID
    let node_id = format!("action_{}", uuid::Uuid::new_v4());

    let node = WorkflowNode::new(node_id.clone(), action);
    workflow.add_node(node).map_err(|e| e.to_string())?;

    // Create edge from previous node if one exists
    let mut last_node = workflow_state.last_node_id.write();
    if let Some(ref prev_node_id) = *last_node {
        use super::actions::DependencyType;
        let edge = WorkflowEdge {
            source: prev_node_id.clone(),
            target: node_id.clone(),
            dependency_type: DependencyType::OrderDependency,
        };
        workflow.add_edge(edge).map_err(|e| e.to_string())?;
    }

    // Update last node ID
    *last_node = Some(node_id.clone());

    Ok(node_id)
}

#[tauri::command]
pub async fn workflow_export(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
) -> Result<String, String> {
    let workflow_state = state.read();
    let workflow = workflow_state.workflow.read();

    let export_data = WorkflowExport {
        nodes: workflow.get_all_nodes().into_iter().cloned().collect(),
        edges: workflow.get_all_edges(),
        metadata: workflow.metadata.clone(),
    };

    serde_json::to_string_pretty(&export_data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workflow_import(
    state: State<'_, Arc<RwLock<WorkflowState>>>,
    json: String,
) -> Result<(), String> {
    let export_data: WorkflowExport = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    let workflow_state = state.read();
    let mut workflow = workflow_state.workflow.write();

    // Clear existing workflow
    workflow.clear();

    // Restore metadata
    workflow.metadata = export_data.metadata;

    // Add nodes
    for node in export_data.nodes {
        workflow.add_node(node).map_err(|e| e.to_string())?;
    }

    // Add edges
    for edge in export_data.edges {
        workflow.add_edge(edge).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkflowExport {
    nodes: Vec<WorkflowNode>,
    edges: Vec<WorkflowEdge>,
    metadata: super::workflow::WorkflowMetadata,
}
