from __future__ import annotations

import math
from typing import List, Optional

from ...domain.models import (
    NetworkMotifAdjacencyMatrix,
    NetworkMotifData,
    NetworkMotifEdge,
)


def build_network_motif_data(
    *,
    q_matrix: List[List[float]],
    channel_pairs: Optional[List[tuple[int, int]]],
    channel_names: List[str],
    delays: List[int | float],
    threshold: float = 0.25,
) -> Optional[NetworkMotifData]:
    if not q_matrix or not channel_pairs:
        return None
    num_timepoints = len(q_matrix[0]) if q_matrix and q_matrix[0] else 0
    if num_timepoints <= 0:
        return None

    unique_nodes = sorted(
        {int(node_index) for pair in channel_pairs for node_index in pair}
    )
    if not unique_nodes:
        return None
    node_index_map = {
        original_index: mapped_index
        for mapped_index, original_index in enumerate(unique_nodes)
    }
    node_labels = [
        channel_names[index] if 0 <= index < len(channel_names) else f"Ch{index + 1}"
        for index in unique_nodes
    ]

    if num_timepoints >= 3:
        selected_indices = [
            num_timepoints // 4,
            num_timepoints // 2,
            (num_timepoints * 3) // 4,
        ]
    elif num_timepoints == 2:
        selected_indices = [0, 1, 1]
    else:
        selected_indices = [0, 0, 0]

    delay_values = [
        float(delays[index]) if 0 <= index < len(delays) else float(index)
        for index in selected_indices
    ]
    adjacency_matrices: List[NetworkMotifAdjacencyMatrix] = []

    for matrix_index, time_index in enumerate(selected_indices):
        values = [
            float(q_matrix[pair_index][time_index])
            if pair_index < len(q_matrix) and time_index < len(q_matrix[pair_index])
            else float("nan")
            for pair_index, _pair in enumerate(channel_pairs)
        ]
        finite_values = [value for value in values if math.isfinite(float(value))]
        if finite_values:
            min_value = min(finite_values)
            max_value = max(finite_values)
            value_range = max_value - min_value
            if value_range > 1e-10:
                values = [
                    (value - min_value) / value_range
                    if math.isfinite(float(value))
                    else float("nan")
                    for value in values
                ]
            else:
                values = [
                    1.0 if math.isfinite(float(value)) else float("nan")
                    for value in values
                ]

        matrix_values = [0.0] * (len(unique_nodes) * len(unique_nodes))
        edges: List[NetworkMotifEdge] = []
        for pair_index, (from_index, to_index) in enumerate(channel_pairs):
            mapped_from = node_index_map.get(int(from_index))
            mapped_to = node_index_map.get(int(to_index))
            if mapped_from is None or mapped_to is None:
                continue
            weight = values[pair_index] if pair_index < len(values) else float("nan")
            if not math.isfinite(float(weight)) or float(weight) < threshold:
                weight = 0.0
            numeric_weight = float(weight)
            matrix_values[mapped_from * len(unique_nodes) + mapped_to] = numeric_weight
            if numeric_weight > 0.0:
                edges.append(
                    NetworkMotifEdge(
                        from_node=mapped_from,
                        to_node=mapped_to,
                        weight=numeric_weight,
                    )
                )

        adjacency_matrices.append(
            NetworkMotifAdjacencyMatrix(
                index=matrix_index,
                delay=delay_values[matrix_index],
                matrix=matrix_values,
                edges=edges,
            )
        )

    return NetworkMotifData(
        num_nodes=len(unique_nodes),
        node_labels=node_labels,
        adjacency_matrices=adjacency_matrices,
        delay_values=delay_values,
    )


def _build_undirected_pairs(indices: List[int]) -> List[tuple[int, int]]:
    pairs: List[tuple[int, int]] = []
    for left_index in range(len(indices)):
        for right_index in range(left_index + 1, len(indices)):
            pairs.append((indices[left_index], indices[right_index]))
    return pairs


def _build_directed_pairs(indices: List[int]) -> List[tuple[int, int]]:
    pairs: List[tuple[int, int]] = []
    for left in indices:
        for right in indices:
            if left != right:
                pairs.append((left, right))
    return pairs
