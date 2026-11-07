//! The DDA variants: every name a variant goes by, and what it computes.

use serde::{Deserialize, Serialize};

/// Size of the SELECT mask (6 bits): ST CT CD RESERVED DE SY.
pub const SELECT_MASK_SIZE: usize = 6;

/// What a variant's rows are made of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelFormat {
    Individual,
    Pairs,
    DirectedPairs,
}

/// One DDA variant. `VARIANTS` lists them in the order the engine returns them.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Variant {
    pub abbreviation: &'static str,
    /// The name the web app and variant config files use, as `cross_dynamical`.
    pub app_id: &'static str,
    pub name: &'static str,
    /// Further names `find` accepts besides the abbreviation and the app id.
    #[serde(skip)]
    aliases: &'static [&'static str],
    /// The variant's bit in the SELECT mask; the CCD family has none.
    #[serde(rename = "position", skip_serializing_if = "Option::is_none")]
    mask_position: Option<usize>,
    pub channel_format: ChannelFormat,
    pub documentation: &'static str,
}

const fn variant(
    abbreviation: &'static str,
    app_id: &'static str,
    name: &'static str,
    mask_position: Option<usize>,
    channel_format: ChannelFormat,
    documentation: &'static str,
) -> Variant {
    Variant {
        abbreviation,
        app_id,
        name,
        aliases: &[],
        mask_position,
        channel_format,
        documentation,
    }
}

const CCD_DOCUMENTATION: &str =
    "Directed pairs conditioned on further channels, a pure-Rust extension of CD.";

pub const VARIANTS: &[Variant] = &[
    variant(
        "ST",
        "single_timeseries",
        "Single Timeseries",
        Some(0),
        ChannelFormat::Individual,
        "Analyzes individual channels independently. Most basic variant. One result row per channel.",
    ),
    variant(
        "CT",
        "cross_timeseries",
        "Cross-Timeseries",
        Some(1),
        ChannelFormat::Pairs,
        "Analyzes relationships between channel pairs. Symmetric: pair (1,2) equals (2,1).",
    ),
    variant(
        "CD",
        "cross_dynamical",
        "Cross-Dynamical",
        Some(2),
        ChannelFormat::DirectedPairs,
        "Analyzes directed causal relationships. Asymmetric: (1->2) differs from (2->1).",
    ),
    variant(
        "CCD",
        "conditional_cross_dynamical",
        "Conditional Cross-Dynamical legacy RMSE gain",
        None,
        ChannelFormat::DirectedPairs,
        CCD_DOCUMENTATION,
    ),
    variant(
        "CCDLOG",
        "conditional_cross_dynamical_log_mse_ratio",
        "Conditional Cross-Dynamical log-MSE ratio",
        None,
        ChannelFormat::DirectedPairs,
        CCD_DOCUMENTATION,
    ),
    variant(
        "CCDPR2",
        "conditional_cross_dynamical_partial_r2",
        "Conditional Cross-Dynamical partial R2",
        None,
        ChannelFormat::DirectedPairs,
        CCD_DOCUMENTATION,
    ),
    variant(
        "CCDSIG",
        "conditional_cross_dynamical_significance",
        "Conditional Cross-Dynamical Significance",
        None,
        ChannelFormat::DirectedPairs,
        CCD_DOCUMENTATION,
    ),
    variant(
        "CCDSTAB",
        "conditional_cross_dynamical_stability",
        "Conditional Cross-Dynamical Stability",
        None,
        ChannelFormat::DirectedPairs,
        CCD_DOCUMENTATION,
    ),
    variant(
        "TRCCD",
        "temporally_regularized_conditional_cross_dynamical",
        "Temporally Regularized Conditional Cross-Dynamical",
        None,
        ChannelFormat::DirectedPairs,
        CCD_DOCUMENTATION,
    ),
    variant(
        "MVCCD",
        "multivariate_conditional_cross_dynamical",
        "Sparse Multivariate Conditional Cross-Dynamical",
        None,
        ChannelFormat::DirectedPairs,
        CCD_DOCUMENTATION,
    ),
    Variant {
        aliases: &["DELAY_EMBEDDING"],
        ..variant(
            "DE",
            "dynamical_ergodicity",
            "Dynamical Ergodicity",
            Some(4),
            ChannelFormat::Individual,
            "Tests for ergodic behavior in dynamical systems. One aggregate measure per channel group and window.",
        )
    },
    Variant {
        aliases: &["SYNCHRONISATION", "SYNCHRONY"],
        ..variant(
            "SY",
            "synchronization",
            "Synchronization",
            Some(5),
            ChannelFormat::Individual,
            "Detects synchronized behavior between signals. One value per channel pair and window.",
        )
    },
];

impl Variant {
    /// How results name the variant: "Cross-Dynamical (CD)".
    pub fn label(&self) -> String {
        format!("{} ({})", self.name, self.abbreviation)
    }

    /// The label (`label`) of the variant `abbreviation` names.
    pub(crate) fn label_of(abbreviation: &str) -> String {
        Self::find(abbreviation).map_or_else(|| abbreviation.to_string(), Self::label)
    }

    /// The variant `name` means: its abbreviation, app id or an alias, in any case, with `_`, `-` or spaces between
    /// words. Every place that reads a variant name (`enabled_variants`, `variant_configs` keys, the command line)
    /// looks it up here.
    pub fn find(name: &str) -> Option<&'static Variant> {
        let key: String = name
            .trim()
            .chars()
            .map(|c| match c {
                '-' | ' ' => '_',
                c => c.to_ascii_uppercase(),
            })
            .collect();
        VARIANTS.iter().find(|v| {
            v.abbreviation == key
                || v.app_id.eq_ignore_ascii_case(&key)
                || v.aliases.contains(&key.as_str())
        })
    }
}

/// The variants of the SELECT mask (ST, CT, CD, DE, SY), which the web app, agents and `ddalab variants` offer; the CCD
/// family runs when named but is not offered.
pub fn offered_variants() -> impl Iterator<Item = &'static Variant> {
    VARIANTS.iter().filter(|v| v.mask_position.is_some())
}

/// The SELECT mask of `variants` (abbreviations), space-separated as requests store it.
pub fn select_mask(variants: &[String]) -> String {
    let mut mask = [0u8; SELECT_MASK_SIZE];
    for v in variants.iter().filter_map(|v| Variant::find(v)) {
        if let Some(position) = v.mask_position {
            mask[position] = 1;
        }
    }
    mask.map(|b| b.to_string()).join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_accepts_abbreviations_app_ids_and_aliases() {
        for (name, id) in [
            ("st", "ST"),
            ("cross-dynamical", "CD"),
            ("Conditional Cross Dynamical", "CCD"),
            ("delay_embedding", "DE"),
            ("synchronisation", "SY"),
        ] {
            assert_eq!(Variant::find(name).map(|v| v.abbreviation), Some(id));
        }
        assert!(Variant::find("INVALID").is_none());
    }

    #[test]
    fn select_mask_sets_the_variants_bits() {
        assert_eq!(
            select_mask(&["ST".into(), "SY".into(), "CCD".into()]),
            "1 0 0 0 0 1"
        );
    }
}
