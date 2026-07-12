use std::collections::BTreeSet;

use crate::types::{CcdConditioningStrategy, DDARequest};

const CCD_CONFIG_KEYS: &[&str] = &[
    "CCD",
    "ccd",
    "conditional_cross_dynamical",
    "conditional-cross-dynamical",
    "ccdlog",
    "conditional_cross_dynamical_log_mse_ratio",
    "ccdpr2",
    "conditional_cross_dynamical_partial_r2",
    "conditional_cross_dynamical_significance",
    "conditional_cross_dynamical_stability",
    "temporally_regularized_conditional_cross_dynamical",
    "multivariate_conditional_cross_dynamical",
];

const CCD_SIGNIFICANCE_CONFIG_KEYS: &[&str] = &[
    "conditional_cross_dynamical_significance",
    "CCD",
    "ccd",
    "conditional_cross_dynamical",
];

const TRCCD_CONFIG_KEYS: &[&str] = &[
    "temporally_regularized_conditional_cross_dynamical",
    "CCD",
    "ccd",
    "conditional_cross_dynamical",
];

const MVCCD_CONFIG_KEYS: &[&str] = &[
    "multivariate_conditional_cross_dynamical",
    "CCD",
    "ccd",
    "conditional_cross_dynamical",
];

#[derive(Debug, Clone, Copy)]
pub(crate) struct VariantMode {
    pub(crate) st_enabled: bool,
    pub(crate) ct_enabled: bool,
    pub(crate) cd_enabled: bool,
    pub(crate) ccd_enabled: bool,
    pub(crate) ccdlog_enabled: bool,
    pub(crate) ccdpr2_enabled: bool,
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

        let select_mask = request
            .algorithm_selection
            .select_mask
            .as_deref()
            .and_then(|mask| {
                let bits: Vec<u8> = mask
                    .split_whitespace()
                    .filter_map(|value| value.parse::<u8>().ok())
                    .collect();
                (bits.len() == 6).then_some(bits)
            });

        let ccdlog_enabled = contains_any(
            &enabled,
            &[
                "CCDLOG",
                "CONDITIONAL_CROSS_DYNAMICAL_LOG_MSE_RATIO",
                "CONDITIONAL-CROSS-DYNAMICAL-LOG-MSE-RATIO",
                "CONDITIONAL CROSS DYNAMICAL LOG MSE RATIO",
            ],
        );
        let ccdpr2_enabled = contains_any(
            &enabled,
            &[
                "CCDPR2",
                "CONDITIONAL_CROSS_DYNAMICAL_PARTIAL_R2",
                "CONDITIONAL-CROSS-DYNAMICAL-PARTIAL-R2",
                "CONDITIONAL CROSS DYNAMICAL PARTIAL R2",
            ],
        );
        let ccdsig_enabled = contains_any(
            &enabled,
            &[
                "CCDSIG",
                "CONDITIONAL_CROSS_DYNAMICAL_SIGNIFICANCE",
                "CONDITIONAL-CROSS-DYNAMICAL-SIGNIFICANCE",
                "CONDITIONAL CROSS DYNAMICAL SIGNIFICANCE",
            ],
        );
        let ccdstab_enabled = contains_any(
            &enabled,
            &[
                "CCDSTAB",
                "CONDITIONAL_CROSS_DYNAMICAL_STABILITY",
                "CONDITIONAL-CROSS-DYNAMICAL-STABILITY",
                "CONDITIONAL CROSS DYNAMICAL STABILITY",
            ],
        );
        let trccd_enabled = contains_any(
            &enabled,
            &[
                "TRCCD",
                "TEMPORALLY_REGULARIZED_CONDITIONAL_CROSS_DYNAMICAL",
                "TEMPORALLY-REGULARIZED-CONDITIONAL-CROSS-DYNAMICAL",
                "TEMPORALLY REGULARIZED CONDITIONAL CROSS DYNAMICAL",
            ],
        );
        let mvccd_enabled = contains_any(
            &enabled,
            &[
                "MVCCD",
                "MULTIVARIATE_CONDITIONAL_CROSS_DYNAMICAL",
                "MULTIVARIATE-CONDITIONAL-CROSS-DYNAMICAL",
                "MULTIVARIATE CONDITIONAL CROSS DYNAMICAL",
            ],
        );
        let ccd_enabled = contains_any(
            &enabled,
            &[
                "CCD",
                "CONDITIONAL_CROSS_DYNAMICAL",
                "CONDITIONAL-CROSS-DYNAMICAL",
                "CONDITIONAL CROSS DYNAMICAL",
                "CCDSIG",
                "CONDITIONAL_CROSS_DYNAMICAL_SIGNIFICANCE",
                "CCDSTAB",
                "CONDITIONAL_CROSS_DYNAMICAL_STABILITY",
                "TRCCD",
                "TEMPORALLY_REGULARIZED_CONDITIONAL_CROSS_DYNAMICAL",
                "MVCCD",
                "MULTIVARIATE_CONDITIONAL_CROSS_DYNAMICAL",
            ],
        );

        let (st_enabled, ct_enabled, cd_enabled, de_enabled, sy_mode) =
            if let Some(bits) = select_mask {
                (
                    bits[0] > 0,
                    bits[1] > 0,
                    bits[2] > 0,
                    bits[4] > 0,
                    bits[5].min(2),
                )
            } else {
                (
                    contains_any(&enabled, &["ST", "SINGLE_TIMESERIES"]),
                    contains_any(&enabled, &["CT", "CROSS_TIMESERIES"]),
                    contains_any(&enabled, &["CD", "CROSS_DYNAMICAL"]),
                    contains_any(&enabled, &["DE", "DYNAMICAL_ERGODICITY", "DELAY_EMBEDDING"]),
                    u8::from(contains_any(
                        &enabled,
                        &["SY", "SYNCHRONIZATION", "SYNCHRONY"],
                    )),
                )
            };

        Self {
            st_enabled,
            ct_enabled,
            cd_enabled,
            ccd_enabled,
            ccdlog_enabled,
            ccdpr2_enabled,
            ccdsig_enabled,
            ccdstab_enabled,
            trccd_enabled,
            mvccd_enabled,
            de_enabled,
            sy_mode,
        }
    }
}

fn contains_any(enabled: &BTreeSet<String>, aliases: &[&str]) -> bool {
    aliases.iter().any(|alias| enabled.contains(*alias))
}

fn find_variant_config<'a>(
    request: &'a DDARequest,
    config_keys: &[&str],
) -> Option<&'a crate::types::VariantChannelConfig> {
    let configs = request.variant_configs.as_ref()?;
    config_keys.iter().find_map(|key| configs.get(*key))
}

fn requested_channels_or_all(request: &DDARequest, total_channels: usize) -> Vec<usize> {
    request
        .channels
        .as_ref()
        .filter(|channels| !channels.is_empty())
        .cloned()
        .unwrap_or_else(|| (0..total_channels).collect())
}

fn directed_pairs(channels: &[usize]) -> Vec<[usize; 2]> {
    channels
        .iter()
        .flat_map(|&target| {
            channels
                .iter()
                .copied()
                .filter(move |&source| target != source)
                .map(move |source| [target, source])
        })
        .collect()
}

fn sliding_channel_groups(
    channels: &[usize],
    window_length: usize,
    window_step: usize,
) -> Vec<Vec<usize>> {
    if window_length == 0 || channels.len() < window_length {
        return Vec::new();
    }

    let mut groups = Vec::new();
    let mut start = 0;
    while start + window_length <= channels.len() {
        groups.push(channels[start..start + window_length].to_vec());
        start += window_step.max(1);
    }
    groups
}

pub(crate) fn resolve_variant_selected_channels(
    request: &DDARequest,
    total_channels: usize,
    config_keys: &[&str],
) -> Vec<usize> {
    request
        .variant_configs
        .as_ref()
        .and_then(|configs| {
            config_keys.iter().find_map(|key| {
                configs
                    .get(*key)?
                    .selected_channels
                    .as_ref()
                    .filter(|channels| !channels.is_empty())
            })
        })
        .or(request
            .channels
            .as_ref()
            .filter(|channels| !channels.is_empty()))
        .cloned()
        .unwrap_or_else(|| (0..total_channels).collect())
}

pub(crate) fn resolve_ct_groups(request: &DDARequest, total_channels: usize) -> Vec<Vec<usize>> {
    if let Some(groups) = request
        .ct_channel_pairs
        .as_ref()
        .filter(|pairs| !pairs.is_empty())
    {
        return groups.iter().map(|pair| pair.to_vec()).collect();
    }

    let mut channels = requested_channels_or_all(request, total_channels);
    if let Some(config) = find_variant_config(request, &["CT", "ct", "cross_timeseries"]) {
        if let Some(groups) = config
            .ct_channel_pairs
            .as_ref()
            .filter(|pairs| !pairs.is_empty())
        {
            return groups.iter().map(|pair| pair.to_vec()).collect();
        }
        if let Some(selected) = config
            .selected_channels
            .as_ref()
            .filter(|channels| !channels.is_empty())
        {
            channels.clone_from(selected);
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
    sliding_channel_groups(&channels, window_length, window_step)
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
    sliding_channel_groups(&channels, window_length, window_step)
}

pub(crate) fn resolve_cd_pairs(request: &DDARequest, total_channels: usize) -> Vec<[usize; 2]> {
    if let Some(pairs) = request
        .cd_channel_pairs
        .as_ref()
        .filter(|pairs| !pairs.is_empty())
    {
        return pairs.clone();
    }

    let mut channels = requested_channels_or_all(request, total_channels);
    if let Some(config) = find_variant_config(request, &["CD", "cd", "cross_dynamical"]) {
        if let Some(pairs) = config
            .cd_channel_pairs
            .as_ref()
            .filter(|pairs| !pairs.is_empty())
        {
            return pairs.clone();
        }
        if let Some(selected) = config
            .selected_channels
            .as_ref()
            .filter(|channels| !channels.is_empty())
        {
            channels.clone_from(selected);
        }
    }

    directed_pairs(&channels)
}

pub(crate) fn resolve_ccd_pairs(request: &DDARequest, total_channels: usize) -> Vec<[usize; 2]> {
    let mut channels = requested_channels_or_all(request, total_channels);
    if let Some(config) = find_variant_config(request, CCD_CONFIG_KEYS) {
        if let Some(pairs) = config
            .cd_channel_pairs
            .as_ref()
            .filter(|pairs| !pairs.is_empty())
        {
            return pairs.clone();
        }
        if let Some(selected) = config
            .selected_channels
            .as_ref()
            .filter(|channels| !channels.is_empty())
        {
            channels.clone_from(selected);
        }
    }

    if let Some(pairs) = request
        .cd_channel_pairs
        .as_ref()
        .filter(|pairs| !pairs.is_empty())
    {
        return pairs.clone();
    }

    directed_pairs(&channels)
}

pub(crate) fn resolve_ccd_conditioning_strategy(request: &DDARequest) -> CcdConditioningStrategy {
    find_variant_config(request, CCD_CONFIG_KEYS)
        .and_then(|config| config.conditioning_strategy)
        .unwrap_or(CcdConditioningStrategy::AllSelected)
}

pub(crate) fn resolve_ccd_candidate_channels(
    request: &DDARequest,
    total_channels: usize,
) -> Vec<usize> {
    if let Some(config) = find_variant_config(request, CCD_CONFIG_KEYS) {
        if let Some(channels) = config
            .conditioning_channels
            .as_ref()
            .filter(|channels| !channels.is_empty())
        {
            return channels.clone();
        }
        if let Some(channels) = config
            .selected_channels
            .as_ref()
            .filter(|channels| !channels.is_empty())
        {
            return channels.clone();
        }
    }

    requested_channels_or_all(request, total_channels)
}

pub(crate) fn resolve_ccd_surrogate_shifts(request: &DDARequest) -> Option<Vec<usize>> {
    find_variant_config(request, CCD_SIGNIFICANCE_CONFIG_KEYS)
        .and_then(|config| config.surrogate_shifts.clone())
        .filter(|shifts| !shifts.is_empty())
}

pub(crate) fn resolve_ccd_temporal_lambda(request: &DDARequest) -> Option<f64> {
    find_variant_config(request, TRCCD_CONFIG_KEYS)
        .and_then(|config| config.temporal_lambda)
        .filter(|value| value.is_finite() && *value >= 0.0)
}

pub(crate) fn resolve_ccd_max_active_sources(request: &DDARequest) -> Option<usize> {
    find_variant_config(request, MVCCD_CONFIG_KEYS)
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
    set.extend(single_channels.iter().copied());
    for group in ct_groups {
        set.extend(group.iter().copied());
    }
    for group in de_groups {
        set.extend(group.iter().copied());
    }
    set.extend(cd_pairs.iter().flatten().copied());
    set.extend(ccd_pairs.iter().flatten().copied());
    set.extend(ccd_conditioning_channels.iter().copied());
    set.into_iter().collect()
}

fn channel_label(all_labels: &[String], channel: usize) -> String {
    all_labels
        .get(channel)
        .cloned()
        .unwrap_or_else(|| format!("Ch {}", channel))
}

pub(crate) fn labels_for_channels(all_labels: &[String], channels: &[usize]) -> Vec<String> {
    channels
        .iter()
        .map(|&channel| channel_label(all_labels, channel))
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
                .map(|&channel| channel_label(all_labels, channel))
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
            let left = channel_label(all_labels, pair[0]);
            let right = channel_label(all_labels, pair[1]);
            format!("{left}{joiner}{right}")
        })
        .collect()
}

pub(crate) fn labels_for_sy(all_labels: &[String], pairs: &[[usize; 2]], mode: u8) -> Vec<String> {
    if mode == 2 {
        pairs
            .iter()
            .flat_map(|pair| {
                let left = channel_label(all_labels, pair[0]);
                let right = channel_label(all_labels, pair[1]);
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
