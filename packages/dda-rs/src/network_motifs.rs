//! Network motif transformation for CD-DDA results
//!
//! Transforms CD-DDA Q-matrices into normalized adjacency matrices
//! for circular network graph visualization.

use serde::{Deserialize, Serialize};

/// Network motif data for visualization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkMotifData {
    /// Number of nodes (systems/channels)
    pub num_nodes: usize,
    /// Node labels
    pub node_labels: Vec<String>,
    /// Three adjacency matrices (one per selected delay/timepoint)
    /// Each matrix is num_nodes × num_nodes, row-major
    pub adjacency_matrices: Vec<AdjacencyMatrix>,
    /// Delay values corresponding to each matrix
    pub delay_values: Vec<f64>,
}

/// A single adjacency matrix with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjacencyMatrix {
    /// Delay index (0, 1, 2 for the 3 selected delays)
    pub index: usize,
    /// Delay value
    pub delay: f64,
    /// Flattened adjacency matrix (row-major, num_nodes × num_nodes)
    pub matrix: Vec<f64>,
    /// Edge list for efficient graph rendering
    /// Each edge: (from_node, to_node, weight)
    pub edges: Vec<NetworkEdge>,
}

/// A directed edge in the network
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEdge {
    pub from: usize,
    pub to: usize,
    pub weight: f64,
}

/// Transform CD-DDA Q-matrix into network motif adjacency matrices
///
/// # Arguments
/// * `q_matrix` - Q-matrix from CD-DDA [num_pairs × num_timepoints]
/// * `channel_pairs` - Directed channel pairs [[from, to], ...]
/// * `channel_names` - Original channel names
/// * `delays` - Delay values corresponding to timepoints
/// * `threshold` - Edge weight threshold (default 0.25)
///
/// # Returns
/// NetworkMotifData with 3 adjacency matrices at 25%, 50%, 75% of delay range
pub fn transform_cd_to_network_motifs(
    q_matrix: &[Vec<f64>],
    channel_pairs: &[[usize; 2]],
    channel_names: &[String],
    delays: &[f64],
    threshold: Option<f64>,
) -> Result<NetworkMotifData, String> {
    let threshold = threshold.unwrap_or(0.25);
    let num_timepoints = if q_matrix.is_empty() {
        0
    } else {
        q_matrix[0].len()
    };

    if num_timepoints == 0 {
        return Err("Q-matrix has no timepoints".to_string());
    }

    // Determine unique nodes from channel pairs
    let mut unique_nodes: Vec<usize> = channel_pairs
        .iter()
        .flat_map(|pair| vec![pair[0], pair[1]])
        .collect();
    unique_nodes.sort();
    unique_nodes.dedup();

    let num_nodes = unique_nodes.len();
    if num_nodes == 0 {
        return Err("No nodes found in channel pairs".to_string());
    }

    // Create node labels
    let node_labels: Vec<String> = unique_nodes
        .iter()
        .map(|&idx| {
            channel_names
                .get(idx)
                .cloned()
                .unwrap_or_else(|| format!("Ch{}", idx + 1))
        })
        .collect();

    // Create node index mapping (original index -> 0-based sequential)
    let node_index_map: std::collections::HashMap<usize, usize> = unique_nodes
        .iter()
        .enumerate()
        .map(|(i, &orig)| (orig, i))
        .collect();

    // Select 3 timepoints at 25%, 50%, 75% of range
    let indices = if num_timepoints >= 3 {
        vec![
            num_timepoints / 4,
            num_timepoints / 2,
            (num_timepoints * 3) / 4,
        ]
    } else if num_timepoints == 2 {
        vec![0, 1, 1]
    } else {
        vec![0, 0, 0]
    };

    let delay_values: Vec<f64> = indices
        .iter()
        .map(|&i| delays.get(i).copied().unwrap_or(i as f64))
        .collect();

    // Build adjacency matrices for each selected timepoint
    let mut adjacency_matrices = Vec::with_capacity(3);

    for (matrix_idx, &time_idx) in indices.iter().enumerate() {
        // Extract values for this timepoint
        let mut values: Vec<f64> = channel_pairs
            .iter()
            .enumerate()
            .map(|(pair_idx, _)| {
                q_matrix
                    .get(pair_idx)
                    .and_then(|row| row.get(time_idx))
                    .copied()
                    .unwrap_or(f64::NAN)
            })
            .collect();

        // Min-max normalization (ignoring NaN)
        let valid_values: Vec<f64> = values.iter().filter(|v| !v.is_nan()).copied().collect();

        if !valid_values.is_empty() {
            let min_val = valid_values.iter().copied().fold(f64::INFINITY, f64::min);
            let max_val = valid_values
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max);
            let range = max_val - min_val;

            if range > 1e-10 {
                for v in &mut values {
                    if !v.is_nan() {
                        *v = (*v - min_val) / range;
                    }
                }
            } else {
                // All values are the same, set to 1.0
                for v in &mut values {
                    if !v.is_nan() {
                        *v = 1.0;
                    }
                }
            }
        }

        // Apply threshold and build adjacency matrix
        let mut matrix = vec![0.0; num_nodes * num_nodes];
        let mut edges = Vec::new();

        for (pair_idx, pair) in channel_pairs.iter().enumerate() {
            let from = *node_index_map.get(&pair[0]).unwrap_or(&0);
            let to = *node_index_map.get(&pair[1]).unwrap_or(&0);
            let mut weight = values.get(pair_idx).copied().unwrap_or(0.0);

            // Apply threshold
            if weight < threshold || weight.is_nan() {
                weight = 0.0;
            }

            matrix[from * num_nodes + to] = weight;

            if weight > 0.0 {
                edges.push(NetworkEdge { from, to, weight });
            }
        }

        adjacency_matrices.push(AdjacencyMatrix {
            index: matrix_idx,
            delay: delay_values[matrix_idx],
            matrix,
            edges,
        });
    }

    Ok(NetworkMotifData {
        num_nodes,
        node_labels,
        adjacency_matrices,
        delay_values,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_cd_to_network_motifs() {
        // 3 channels, 6 directed pairs (full connectivity)
        let channel_pairs = vec![[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];

        // Q-matrix: 6 pairs × 5 timepoints
        let q_matrix = vec![
            vec![0.1, 0.2, 0.3, 0.4, 0.5],
            vec![0.2, 0.3, 0.4, 0.5, 0.6],
            vec![0.3, 0.4, 0.5, 0.6, 0.7],
            vec![0.4, 0.5, 0.6, 0.7, 0.8],
            vec![0.5, 0.6, 0.7, 0.8, 0.9],
            vec![0.6, 0.7, 0.8, 0.9, 1.0],
        ];

        let channel_names = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        let scales = vec![0.1, 0.2, 0.3, 0.4, 0.5];

        let result = transform_cd_to_network_motifs(
            &q_matrix,
            &channel_pairs,
            &channel_names,
            &scales,
            Some(0.25),
        )
        .unwrap();

        assert_eq!(result.num_nodes, 3);
        assert_eq!(result.node_labels, vec!["A", "B", "C"]);
        assert_eq!(result.adjacency_matrices.len(), 3);

        // Each matrix should be 3x3 = 9 elements
        for matrix in &result.adjacency_matrices {
            assert_eq!(matrix.matrix.len(), 9);
        }
    }

    #[test]
    fn test_normalization_and_threshold() {
        let channel_pairs = vec![[0, 1], [1, 0]];
        let q_matrix = vec![vec![0.0, 0.5, 1.0], vec![0.0, 0.25, 0.5]];
        let channel_names = vec!["X".to_string(), "Y".to_string()];
        let scales = vec![0.1, 0.2, 0.3];

        let result = transform_cd_to_network_motifs(
            &q_matrix,
            &channel_pairs,
            &channel_names,
            &scales,
            Some(0.25),
        )
        .unwrap();

        // Middle timepoint (index 1)
        let middle_matrix = &result.adjacency_matrices[1];

        // After normalization:
        // Pair 0: 0.5 -> (0.5 - 0) / 1 = 0.5 (kept, > 0.25)
        // Pair 1: 0.25 -> (0.25 - 0) / 0.5 = 0.5 (kept, > 0.25)
        assert!(middle_matrix.edges.len() >= 1);
    }
}
