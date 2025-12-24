use ddalab_tauri::recording::{
    actions::{FileType, WorkflowAction},
    buffer::{ActionBuffer, BufferedAction},
};

#[test]
fn test_buffer_records_actions() {
    let mut buffer = ActionBuffer::new();

    // Simulate user loading a file
    let action1 = BufferedAction::new(WorkflowAction::LoadFile {
        path: "/path/to/data.edf".to_string(),
        file_type: FileType::EDF,
    })
    .with_file_context(Some("file_001".to_string()));

    buffer.record(action1);

    // Simulate user selecting channels
    let action2 = BufferedAction::new(WorkflowAction::SelectChannels {
        channel_indices: vec![0, 1, 2, 3],
    })
    .with_file_context(Some("file_001".to_string()));

    buffer.record(action2);

    // Simulate setting DDA parameters (with corrected parameters)
    let action3 = BufferedAction::new(WorkflowAction::SetDDAParameters {
        window_length: 1000,
        window_step: 100,
        ct_window_length: Some(500),
        ct_window_step: Some(50),
    })
    .with_file_context(Some("file_001".to_string()));

    buffer.record(action3);

    // Verify buffer has all actions
    assert_eq!(buffer.len(), 3);

    // Get all actions
    let all_actions = buffer.get_all();
    assert_eq!(all_actions.len(), 3);

    // Verify file context is preserved
    assert_eq!(all_actions[0].active_file_id, Some("file_001".to_string()));
}

#[test]
fn test_buffer_to_workflow_conversion() {
    let mut buffer = ActionBuffer::new();

    // Add a sequence of actions
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

    buffer.record(BufferedAction::new(WorkflowAction::SetDelayList {
        delays: vec![-10, -5, 0, 5, 10],
    }));

    buffer.record(BufferedAction::new(WorkflowAction::RunDDAAnalysis {
        input_id: "file_001".to_string(),
        channel_selection: vec![0, 1, 2],
        ct_channel_pairs: None,
        cd_channel_pairs: None,
    }));

    // Convert to workflow
    let workflow = buffer
        .to_workflow("test_analysis".to_string())
        .expect("Should convert to workflow");

    // Verify workflow has correct number of nodes
    assert_eq!(workflow.node_count(), 5);

    // Verify workflow has sequential edges (4 edges for 5 nodes)
    assert_eq!(workflow.edge_count(), 4);

    // Verify topological order works
    let order = workflow
        .get_topological_order()
        .expect("Should get topological order");
    assert_eq!(order.len(), 5);
}

#[test]
fn test_buffer_capacity_limit() {
    let mut buffer = ActionBuffer::with_capacity(3);

    // Add 5 actions (should evict 2 oldest)
    for i in 0..5 {
        buffer.record(BufferedAction::new(WorkflowAction::LoadFile {
            path: format!("file_{}.edf", i),
            file_type: FileType::EDF,
        }));
    }

    // Buffer should only contain last 3 actions
    assert_eq!(buffer.len(), 3);

    // Total recorded should be 5
    assert_eq!(buffer.total_recorded(), 5);
}

#[test]
fn test_corrected_dda_parameters() {
    let mut buffer = ActionBuffer::new();

    // Test SetDDAParameters with correct parameters
    buffer.record(BufferedAction::new(WorkflowAction::SetDDAParameters {
        window_length: 2048,
        window_step: 512,
        ct_window_length: Some(1024),
        ct_window_step: Some(256),
    }));

    // Test SetDelayList
    buffer.record(BufferedAction::new(WorkflowAction::SetDelayList {
        delays: vec![-100, -50, 0, 50, 100],
    }));

    // Test SetModelParameters
    buffer.record(BufferedAction::new(WorkflowAction::SetModelParameters {
        dm: 3,
        order: 2,
        nr_tau: 5,
        encoding: vec![1, 2, 3],
    }));

    // Test RunDDAAnalysis with channel pairs
    buffer.record(BufferedAction::new(WorkflowAction::RunDDAAnalysis {
        input_id: "input_001".to_string(),
        channel_selection: vec![0, 1, 2],
        ct_channel_pairs: Some(vec![[0, 1], [0, 2], [1, 2]]),
        cd_channel_pairs: Some(vec![[0, 1]]),
    }));

    assert_eq!(buffer.len(), 4);

    let workflow = buffer
        .to_workflow("dda_test".to_string())
        .expect("Should convert to workflow");

    assert_eq!(workflow.node_count(), 4);
}

#[test]
fn test_get_last_n_actions() {
    let mut buffer = ActionBuffer::new();

    // Add 10 actions
    for i in 0..10 {
        buffer.record(BufferedAction::new(WorkflowAction::LoadFile {
            path: format!("file_{}.edf", i),
            file_type: FileType::EDF,
        }));
    }

    // Get last 3 actions
    let last_3 = buffer.get_last_n_actions(3);
    assert_eq!(last_3.len(), 3);

    // Verify order (should be most recent)
    if let WorkflowAction::LoadFile { path, .. } = &last_3[0].action {
        assert_eq!(path, "file_7.edf");
    } else {
        panic!("Expected LoadFile action");
    }
}
