use std::collections::BTreeSet;

use crate::types::{CcdConditioningStrategy, DDARequest};

#[derive(Debug, Clone, Copy)]
pub(crate) struct VariantMode {
    pub(crate) st_enabled: bool,
    pub(crate) ct_enabled: bool,
    pub(crate) cd_enabled: bool,
    pub(crate) ccd_enabled: bool,
    pub(crate) ccdsig_enabled: bool,
    pub(crate) ccdstab_enabled: bool,
    pub(crate) trccd_enabled: bool,
    pub(crate) mvccd_enabled: bool,
    pub(crate) de_enabled: bool,
    pub(crate) sy_mode: u8,
}

impl VariantMode {
    pub(crate) fn from_request(request: &DDARequest) -> Self {
        let enabled: BTreeSet<String> = request
            .algorithm_selection
            .enabled_variants
            .iter()
            .map(|token| token.trim().to_ascii_uppercase())
            .collect();
        if let Some(mask) = request.algorithm_selection.select_mask.as_deref() {
            let bits: Vec<u8> = mask
                .split_whitespace()
                .filter_map(|value| value.parse::<u8>().ok())
                .collect();
            if bits.len() == 6 {
                return Self {
                    st_enabled: bits[0] > 0,
                    ct_enabled: bits[1] > 0,
                    cd_enabled: bits[2] > 0,
                    ccd_enabled: enabled.contains("CCD")
                        || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL")
                        || enabled.contains("CONDITIONAL-CROSS-DYNAMICAL")
                        || enabled.contains("CONDITIONAL CROSS DYNAMICAL")
                        || enabled.contains("CCDSIG")
                        || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL_SIGNIFICANCE")
                        || enabled.contains("CCDSTAB")
                        || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL_STABILITY")
                        || enabled.contains("TRCCD")
                        || enabled.contains("TEMPORALLY_REGULARIZED_CONDITIONAL_CROSS_DYNAMICAL")
                        || enabled.contains("MVCCD")
                        || enabled.contains("MULTIVARIATE_CONDITIONAL_CROSS_DYNAMICAL"),
                    ccdsig_enabled: enabled.contains("CCDSIG")
                        || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL_SIGNIFICANCE")
                        || enabled.contains("CONDITIONAL-CROSS-DYNAMICAL-SIGNIFICANCE")
                        || enabled.contains("CONDITIONAL CROSS DYNAMICAL SIGNIFICANCE"),
                    ccdstab_enabled: enabled.contains("CCDSTAB")
                        || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL_STABILITY")
                        || enabled.contains("CONDITIONAL-CROSS-DYNAMICAL-STABILITY")
                        || enabled.contains("CONDITIONAL CROSS DYNAMICAL STABILITY"),
                    trccd_enabled: enabled.contains("TRCCD")
                        || enabled.contains("TEMPORALLY_REGULARIZED_CONDITIONAL_CROSS_DYNAMICAL")
                        || enabled.contains("TEMPORALLY-REGULARIZED-CONDITIONAL-CROSS-DYNAMICAL")
                        || enabled.contains("TEMPORALLY REGULARIZED CONDITIONAL CROSS DYNAMICAL"),
                    mvccd_enabled: enabled.contains("MVCCD")
                        || enabled.contains("MULTIVARIATE_CONDITIONAL_CROSS_DYNAMICAL")
                        || enabled.contains("MULTIVARIATE-CONDITIONAL-CROSS-DYNAMICAL")
                        || enabled.contains("MULTIVARIATE CONDITIONAL CROSS DYNAMICAL"),
                    de_enabled: bits[4] > 0,
                    sy_mode: bits[5].min(2),
                };
            }
        }

        Self {
            st_enabled: enabled.contains("ST") || enabled.contains("SINGLE_TIMESERIES"),
            ct_enabled: enabled.contains("CT") || enabled.contains("CROSS_TIMESERIES"),
            cd_enabled: enabled.contains("CD") || enabled.contains("CROSS_DYNAMICAL"),
            ccd_enabled: enabled.contains("CCD")
                || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL")
                || enabled.contains("CONDITIONAL-CROSS-DYNAMICAL")
                || enabled.contains("CONDITIONAL CROSS DYNAMICAL")
                || enabled.contains("CCDSIG")
                || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL_SIGNIFICANCE")
                || enabled.contains("CCDSTAB")
                || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL_STABILITY")
                || enabled.contains("TRCCD")
                || enabled.contains("TEMPORALLY_REGULARIZED_CONDITIONAL_CROSS_DYNAMICAL")
                || enabled.contains("MVCCD")
                || enabled.contains("MULTIVARIATE_CONDITIONAL_CROSS_DYNAMICAL"),
            ccdsig_enabled: enabled.contains("CCDSIG")
                || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL_SIGNIFICANCE")
                || enabled.contains("CONDITIONAL-CROSS-DYNAMICAL-SIGNIFICANCE")
                || enabled.contains("CONDITIONAL CROSS DYNAMICAL SIGNIFICANCE"),
            ccdstab_enabled: enabled.contains("CCDSTAB")
                || enabled.contains("CONDITIONAL_CROSS_DYNAMICAL_STABILITY")
                || enabled.contains("CONDITIONAL-CROSS-DYNAMICAL-STABILITY")
                || enabled.contains("CONDITIONAL CROSS DYNAMICAL STABILITY"),
            trccd_enabled: enabled.contains("TRCCD")
                || enabled.contains("TEMPORALLY_REGULARIZED_CONDITIONAL_CROSS_DYNAMICAL")
                || enabled.contains("TEMPORALLY-REGULARIZED-CONDITIONAL-CROSS-DYNAMICAL")
                || enabled.contains("TEMPORALLY REGULARIZED CONDITIONAL CROSS DYNAMICAL"),
            mvccd_enabled: enabled.contains("MVCCD")
                || enabled.contains("MULTIVARIATE_CONDITIONAL_CROSS_DYNAMICAL")
                || enabled.contains("MULTIVARIATE-CONDITIONAL-CROSS-DYNAMICAL")
                || enabled.contains("MULTIVARIATE CONDITIONAL CROSS DYNAMICAL"),
            de_enabled: enabled.contains("DE")
                || enabled.contains("DYNAMICAL_ERGODICITY")
                || enabled.contains("DELAY_EMBEDDING"),
            sy_mode: if enabled.contains("SY")
                || enabled.contains("SYNCHRONIZATION")
                || enabled.contains("SYNCHRONY")
            {
                1
            } else {
                0
            },
        }
    }
}

fn find_variant_config<'a>(
    request: &'a DDARequest,
    config_keys: &[&str],
) -> Option<&'a crate::types::VariantChannelConfig> {
    let configs = request.variant_configs.as_ref()?;
    config_keys.iter().find_map(|key| configs.get(*key))
}

pub(crate) fn resolve_variant_selected_channels(
    request: &DDARequest,
    total_channels: usize,
    config_keys: &[&str],
) -> Vec<usize> {
    if let Some(configs) = &request.variant_configs {
        for key in config_keys {
            if let Some(channels) = configs
                .get(*key)
                .and_then(|config| config.selected_channels.clone())
                .filter(|channels| !channels.is_empty())
            {
                return channels;
            }
        }
    }
    request
        .channels
        .clone()
        .filter(|channels| !channels.is_empty())
        .unwrap_or_else(|| (0..total_channels).collect())
}

pub(crate) fn resolve_ct_groups(request: &DDARequest, total_channels: usize) -> Vec<Vec<usize>> {
    if let Some(groups) = request
        .ct_channel_pairs
        .clone()
        .filter(|pairs| !pairs.is_empty())
    {
        return groups.into_iter().map(|pair| pair.to_vec()).collect();
    }

    let mut channels = request
        .channels
        .clone()
        .filter(|channels| !channels.is_empty())
        .unwrap_or_else(|| (0..total_channels).collect());
    if let Some(configs) = &request.variant_configs {
        if let Some(config) = ["CT", "ct", "cross_timeseries"]
            .iter()
            .find_map(|key| configs.get(*key))
        {
            if let Some(groups) = config
                .ct_channel_pairs
                .clone()
                .filter(|pairs| !pairs.is_empty())
            {
                return groups.into_iter().map(|pair| pair.to_vec()).collect();
            }
            if let Some(selected) = config
                .selected_channels
                .clone()
                .filter(|channels| !channels.is_empty())
            {
                channels = selected;
            }
        }
    }

    let window_length = request
        .window_parameters
        .ct_window_length
        .unwrap_or(channels.len() as u32) as usize;
    let window_step = request
        .window_parameters
        .ct_window_step
        .unwrap_or(window_length.max(1) as u32) as usize;
    if channels.len() < window_length || window_length == 0 {
        return Vec::new();
    }
    let mut groups = Vec::new();
    let mut start = 0usize;
    while start + window_length <= channels.len() {
        groups.push(channels[start..start + window_length].to_vec());
        start += window_step.max(1);
    }
    groups
}

pub(crate) fn resolve_de_groups(
    request: &DDARequest,
    total_channels: usize,
    selected_channels: &[usize],
) -> Vec<Vec<usize>> {
    let channels = if selected_channels.is_empty() {
        (0..total_channels).collect::<Vec<_>>()
    } else {
        selected_channels.to_vec()
    };
    let window_length = request
        .window_parameters
        .ct_window_length
        .unwrap_or(channels.len() as u32) as usize;
    let window_step = request
        .window_parameters
        .ct_window_step
        .unwrap_or(window_length.max(1) as u32) as usize;
    if channels.len() < window_length || window_length == 0 {
        return Vec::new();
    }

    let mut groups = Vec::new();
    let mut start = 0usize;
    while start + window_length <= channels.len() {
        groups.push(channels[start..start + window_length].to_vec());
        start += window_step.max(1);
    }
    groups
}

pub(crate) fn resolve_cd_pairs(request: &DDARequest, total_channels: usize) -> Vec<[usize; 2]> {
    if let Some(pairs) = request
        .cd_channel_pairs
        .clone()
        .filter(|pairs| !pairs.is_empty())
    {
        return pairs;
    }

    let mut channels = request
        .channels
        .clone()
        .filter(|channels| !channels.is_empty())
        .unwrap_or_else(|| (0..total_channels).collect());
    if let Some(configs) = &request.variant_configs {
        if let Some(config) = ["CD", "cd", "cross_dynamical"]
            .iter()
            .find_map(|key| configs.get(*key))
        {
            if let Some(pairs) = config
                .cd_channel_pairs
                .clone()
                .filter(|pairs| !pairs.is_empty())
            {
                return pairs;
            }
            if let Some(selected) = config
                .selected_channels
                .clone()
                .filter(|channels| !channels.is_empty())
            {
                channels = selected;
            }
        }
    }

    let mut pairs = Vec::new();
    for &target in &channels {
        for &source in &channels {
            if target != source {
                pairs.push([target, source]);
            }
        }
    }
    pairs
}

pub(crate) fn resolve_ccd_pairs(request: &DDARequest, total_channels: usize) -> Vec<[usize; 2]> {
    let mut channels = request
        .channels
        .clone()
        .filter(|channels| !channels.is_empty())
        .unwrap_or_else(|| (0..total_channels).collect());
    if let Some(config) = find_variant_config(
        request,
        &[
            "CCD",
            "ccd",
            "conditional_cross_dynamical",
            "conditional-cross-dynamical",
            "conditional_cross_dynamical_significance",
            "conditional_cross_dynamical_stability",
            "temporally_regularized_conditional_cross_dynamical",
            "multivariate_conditional_cross_dynamical",
        ],
    ) {
        if let Some(pairs) = config
            .cd_channel_pairs
            .clone()
            .filter(|pairs| !pairs.is_empty())
        {
            return pairs;
        }
        if let Some(selected) = config
            .selected_channels
            .clone()
            .filter(|channels| !channels.is_empty())
        {
            channels = selected;
        }
    }

    if let Some(pairs) = request
        .cd_channel_pairs
        .clone()
        .filter(|pairs| !pairs.is_empty())
    {
        return pairs;
    }

    let mut pairs = Vec::new();
    for &target in &channels {
        for &source in &channels {
            if target != source {
                pairs.push([target, source]);
            }
        }
    }
    pairs
}

pub(crate) fn resolve_ccd_conditioning_strategy(request: &DDARequest) -> CcdConditioningStrategy {
    find_variant_config(
        request,
        &[
            "CCD",
            "ccd",
            "conditional_cross_dynamical",
            "conditional-cross-dynamical",
            "conditional_cross_dynamical_significance",
            "conditional_cross_dynamical_stability",
            "temporally_regularized_conditional_cross_dynamical",
            "multivariate_conditional_cross_dynamical",
        ],
    )
    .and_then(|config| config.conditioning_strategy)
    .unwrap_or(CcdConditioningStrategy::AllSelected)
}

pub(crate) fn resolve_ccd_candidate_channels(
    request: &DDARequest,
    total_channels: usize,
) -> Vec<usize> {
    if let Some(config) = find_variant_config(
        request,
        &[
            "CCD",
            "ccd",
            "conditional_cross_dynamical",
            "conditional-cross-dynamical",
            "conditional_cross_dynamical_significance",
            "conditional_cross_dynamical_stability",
            "temporally_regularized_conditional_cross_dynamical",
            "multivariate_conditional_cross_dynamical",
        ],
    ) {
        if let Some(channels) = config
            .conditioning_channels
            .clone()
            .filter(|channels| !channels.is_empty())
        {
            return channels;
        }
        if let Some(channels) = config
            .selected_channels
            .clone()
            .filter(|channels| !channels.is_empty())
        {
            return channels;
        }
    }

    request
        .channels
        .clone()
        .filter(|channels| !channels.is_empty())
        .unwrap_or_else(|| (0..total_channels).collect())
}

pub(crate) fn resolve_ccd_surrogate_shifts(request: &DDARequest) -> Option<Vec<usize>> {
    find_variant_config(
        request,
        &[
            "conditional_cross_dynamical_significance",
            "CCD",
            "ccd",
            "conditional_cross_dynamical",
        ],
    )
    .and_then(|config| config.surrogate_shifts.clone())
    .filter(|shifts| !shifts.is_empty())
}

pub(crate) fn resolve_ccd_temporal_lambda(request: &DDARequest) -> Option<f64> {
    find_variant_config(
        request,
        &[
            "temporally_regularized_conditional_cross_dynamical",
            "CCD",
            "ccd",
            "conditional_cross_dynamical",
        ],
    )
    .and_then(|config| config.temporal_lambda)
    .filter(|value| value.is_finite() && *value >= 0.0)
}

pub(crate) fn resolve_ccd_max_active_sources(request: &DDARequest) -> Option<usize> {
    find_variant_config(
        request,
        &[
            "multivariate_conditional_cross_dynamical",
            "CCD",
            "ccd",
            "conditional_cross_dynamical",
        ],
    )
    .and_then(|config| config.max_active_sources)
    .filter(|value| *value > 0)
}

pub(crate) fn resolve_sy_pairs(channels: &[usize]) -> Vec<[usize; 2]> {
    if channels.len() < 2 {
        return Vec::new();
    }

    channels
        .chunks(2)
        .filter_map(|chunk| {
            if chunk.len() == 2 {
                Some([chunk[0], chunk[1]])
            } else {
                None
            }
        })
        .collect()
}

pub(crate) fn collect_analysis_channels(
    single_channels: &[usize],
    ct_groups: &[Vec<usize>],
    de_groups: &[Vec<usize>],
    cd_pairs: &[[usize; 2]],
    ccd_pairs: &[[usize; 2]],
    ccd_conditioning_channels: &[usize],
) -> Vec<usize> {
    let mut set = BTreeSet::new();
    for &channel in single_channels {
        set.insert(channel);
    }
    for group in ct_groups {
        for &channel in group {
            set.insert(channel);
        }
    }
    for group in de_groups {
        for &channel in group {
            set.insert(channel);
        }
    }
    for pair in cd_pairs {
        set.insert(pair[0]);
        set.insert(pair[1]);
    }
    for pair in ccd_pairs {
        set.insert(pair[0]);
        set.insert(pair[1]);
    }
    for &channel in ccd_conditioning_channels {
        set.insert(channel);
    }
    set.into_iter().collect()
}

pub(crate) fn labels_for_channels(all_labels: &[String], channels: &[usize]) -> Vec<String> {
    channels
        .iter()
        .map(|&channel| {
            all_labels
                .get(channel)
                .cloned()
                .unwrap_or_else(|| format!("Ch {}", channel))
        })
        .collect()
}

pub(crate) fn labels_for_groups(
    all_labels: &[String],
    groups: &[Vec<usize>],
    joiner: &str,
) -> Vec<String> {
    groups
        .iter()
        .map(|group| {
            group
                .iter()
                .map(|&channel| {
                    all_labels
                        .get(channel)
                        .cloned()
                        .unwrap_or_else(|| format!("Ch {}", channel))
                })
                .collect::<Vec<_>>()
                .join(joiner)
        })
        .collect()
}

pub(crate) fn labels_for_pairs(
    all_labels: &[String],
    pairs: &[[usize; 2]],
    joiner: &str,
) -> Vec<String> {
    pairs
        .iter()
        .map(|pair| {
            let left = all_labels
                .get(pair[0])
                .cloned()
                .unwrap_or_else(|| format!("Ch {}", pair[0]));
            let right = all_labels
                .get(pair[1])
                .cloned()
                .unwrap_or_else(|| format!("Ch {}", pair[1]));
            format!("{left}{joiner}{right}")
        })
        .collect()
}

pub(crate) fn labels_for_sy(all_labels: &[String], pairs: &[[usize; 2]], mode: u8) -> Vec<String> {
    if mode == 2 {
        pairs
            .iter()
            .flat_map(|pair| {
                let left = all_labels
                    .get(pair[0])
                    .cloned()
                    .unwrap_or_else(|| format!("Ch {}", pair[0]));
                let right = all_labels
                    .get(pair[1])
                    .cloned()
                    .unwrap_or_else(|| format!("Ch {}", pair[1]));
                [format!("{left} -> {right}"), format!("{right} -> {left}")]
            })
            .collect()
    } else {
        labels_for_pairs(all_labels, pairs, " <-> ")
    }
}

pub(crate) fn flip_pairs(pairs: &[[usize; 2]]) -> Vec<[usize; 2]> {
    pairs.iter().map(|pair| [pair[1], pair[0]]).collect()
}
