use dda_rs::{
    generate_select_mask, VariantMetadata, DEFAULT_DELAYS, DEFAULT_MODEL_DIMENSION,
    DEFAULT_MODEL_TERMS, DEFAULT_NUM_TAU, DEFAULT_POLYNOMIAL_ORDER, DEFAULT_WINDOW_LENGTH,
    DEFAULT_WINDOW_STEP, VARIANT_ORDER,
};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct ContractDefaults {
    window_length: u32,
    window_step: u32,
    model_dimension: u32,
    polynomial_order: u32,
    num_tau: u32,
    model_terms: Vec<i32>,
    delays: Vec<i32>,
}

#[derive(Debug, Deserialize)]
struct SelectMaskCase {
    name: String,
    variants: Vec<String>,
    mask: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct ConformanceContract {
    #[allow(dead_code)]
    contract_version: String,
    #[allow(dead_code)]
    dda_spec_version: String,
    defaults: ContractDefaults,
    variant_order: Vec<String>,
    active_variants: Vec<String>,
    ct_window_required_for: Vec<String>,
    select_mask_cases: Vec<SelectMaskCase>,
}

fn load_contract() -> ConformanceContract {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../conformance/dda_conformance_contract.json");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read contract file {}: {}", path.display(), e));
    serde_json::from_str(&content)
        .unwrap_or_else(|e| panic!("failed to parse contract file {}: {}", path.display(), e))
}

#[test]
fn default_parameters_match_contract() {
    let contract = load_contract();
    assert_eq!(DEFAULT_WINDOW_LENGTH, contract.defaults.window_length);
    assert_eq!(DEFAULT_WINDOW_STEP, contract.defaults.window_step);
    assert_eq!(DEFAULT_MODEL_DIMENSION, contract.defaults.model_dimension);
    assert_eq!(DEFAULT_POLYNOMIAL_ORDER, contract.defaults.polynomial_order);
    assert_eq!(DEFAULT_NUM_TAU, contract.defaults.num_tau);
    assert_eq!(DEFAULT_MODEL_TERMS.to_vec(), contract.defaults.model_terms);
    assert_eq!(DEFAULT_DELAYS.to_vec(), contract.defaults.delays);
}

#[test]
fn variant_order_matches_contract() {
    let contract = load_contract();
    let contract_order: Vec<&str> = contract.variant_order.iter().map(String::as_str).collect();
    assert_eq!(VARIANT_ORDER, contract_order.as_slice());

    let active: Vec<String> = VariantMetadata::active_variants()
        .map(|v| v.abbreviation.to_string())
        .collect();
    assert_eq!(active, contract.active_variants);
}

#[test]
fn select_mask_cases_match_contract() {
    let contract = load_contract();
    for case in contract.select_mask_cases {
        let variants: Vec<&str> = case.variants.iter().map(String::as_str).collect();
        let got = generate_select_mask(&variants);
        assert_eq!(
            got.to_vec(),
            case.mask,
            "select mask mismatch for case '{}'",
            case.name
        );
    }
}

#[test]
fn ct_variants_require_ct_flags() {
    let contract = load_contract();
    for abbrev in contract.ct_window_required_for {
        let variant = VariantMetadata::from_abbrev(&abbrev)
            .unwrap_or_else(|| panic!("unknown variant in contract: {}", abbrev));
        assert!(
            variant.required_params.contains(&"-WL_CT"),
            "{} missing -WL_CT requirement",
            abbrev
        );
        assert!(
            variant.required_params.contains(&"-WS_CT"),
            "{} missing -WS_CT requirement",
            abbrev
        );
    }
}
