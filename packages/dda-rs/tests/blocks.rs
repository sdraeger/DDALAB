use std::collections::HashMap;
use std::sync::Mutex;

use dda_rs::blocks::{
    block_of, check_block_support, merge_blocks, plan_blocks, run_block, validate_request, Block,
};
use dda_rs::io::{ChannelInfo, ChannelKind, RawType, Reader, RecordingInfo};
use dda_rs::{
    run_request_on_matrix, AlgorithmSelection, CcdConditioningStrategy, DDARequest, DDAResult,
    DelayParameters, ModelParameters, PreprocessingOptions, PureRustProgress, Result, TimeRange,
    VariantChannelConfig, WindowParameters,
};

const ROWS: usize = 20_000;
const CHANNELS: usize = 6;
const WINDOW_LENGTH: usize = 200;
/// `WINDOW_LENGTH + max(delays) + 2*dm`.
const MARKER: usize = WINDOW_LENGTH + 10 + 2 * 4;

/// Two coupled Rössler oscillators (a = b = 0.2, c = 5.7, the second 3% faster, x coupling 0.05),
/// RK4 with dt = 0.05 from a seeded initial state after 1,000 burn-in steps. Channels x1 y1 z1 x2 y2 z2.
fn rossler(seed: u64, rows: usize) -> Vec<Vec<f64>> {
    let mut x = seed;
    let mut uniform = || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        (x >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    };
    let mut state: [f64; 6] = std::array::from_fn(|_| uniform());
    let (a, b, c, w, k, dt) = (0.2, 0.2, 5.7, 1.03, 0.05, 0.05);
    let f = |v: [f64; 6]| {
        [
            -v[1] - v[2] + k * (v[3] - v[0]),
            v[0] + a * v[1],
            b + v[2] * (v[0] - c),
            -w * v[4] - v[5] + k * (v[0] - v[3]),
            w * v[3] + a * v[4],
            b + v[5] * (v[3] - c),
        ]
    };
    let step =
        |v: [f64; 6], d: [f64; 6], h: f64| -> [f64; 6] { std::array::from_fn(|i| v[i] + h * d[i]) };
    let mut out = Vec::with_capacity(rows);
    for n in 0..1_000 + rows {
        let k1 = f(state);
        let k2 = f(step(state, k1, dt / 2.0));
        let k3 = f(step(state, k2, dt / 2.0));
        let k4 = f(step(state, k3, dt));
        state = std::array::from_fn(|i| {
            state[i] + dt / 6.0 * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i])
        });
        if n >= 1_000 {
            out.push(state.to_vec());
        }
    }
    out
}

/// The fixture channels behind the `Reader` interface, with a status channel at recording index 2
/// that is not an analysis channel. `reads` keeps the channels of each `read_rows`.
struct Recording {
    info: RecordingInfo,
    rows: Vec<Vec<f64>>,
    reads: Mutex<Vec<Vec<usize>>>,
}

impl Recording {
    fn new(signals: &[Vec<f64>]) -> Self {
        let channel = |label: String, kind| ChannelInfo {
            label,
            unit: "V".into(),
            sample_rate_hz: 100.0,
            gain: 1.0,
            offset: 0.0,
            kind,
            bids_status: None,
            bids_type: None,
        };
        let mut channels: Vec<ChannelInfo> = (0..signals[0].len())
            .map(|c| channel(format!("s{c}"), ChannelKind::Signal))
            .collect();
        channels.insert(2, channel("status".into(), ChannelKind::Status));
        let rows = signals
            .iter()
            .enumerate()
            .map(|(r, row)| {
                let mut row = row.clone();
                row.insert(2, r as f64);
                row
            })
            .collect();
        let info = RecordingInfo {
            format: "test".into(),
            channels,
            sample_rate_hz: 100.0,
            sample_count: signals.len() as u64,
            duration_s: signals.len() as f64 / 100.0,
            raw_type: RawType::F64,
            annotations: vec![],
            warnings: vec![],
            input_files: vec![],
        };
        Recording {
            info,
            rows,
            reads: Mutex::default(),
        }
    }
}

impl Reader for Recording {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        self.reads.lock().unwrap().push(channels.to_vec());
        let row0 = row0 as usize;
        Ok(self.rows[row0..row0 + rows]
            .iter()
            .map(|row| channels.iter().map(|&c| row[c]).collect())
            .collect())
    }

    fn read_raw_f32(&self, _: &[usize], _: u64, _: usize, _: &mut [f32]) -> Result<()> {
        unimplemented!()
    }
}

fn request(variant: &str) -> DDARequest {
    DDARequest {
        file_path: "rossler".into(),
        channels: None,
        time_range: TimeRange {
            start: 0.0,
            end: f64::INFINITY,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec![variant.into()],
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: WINDOW_LENGTH as u32,
            window_step: 50,
            ct_window_length: None,
            ct_window_step: None,
        },
        delay_parameters: DelayParameters {
            delays: vec![7, 10],
        },
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: Some(ModelParameters {
            dm: 4,
            order: 4,
            nr_tau: 2,
        }),
        model_terms: Some(vec![1, 2, 10]),
        variant_configs: None,
        sampling_rate: None,
    }
}

fn ccd_request(variant: &str, strategy: CcdConditioningStrategy) -> DDARequest {
    let mut request = request(variant);
    request.variant_configs = Some(HashMap::from([(
        "conditional_cross_dynamical".to_string(),
        VariantChannelConfig {
            selected_channels: Some(vec![0, 1, 2, 3]),
            ct_channel_pairs: None,
            cd_channel_pairs: Some(vec![[1, 0], [3, 2]]),
            conditioning_channels: None,
            conditioning_strategy: Some(strategy),
            surrogate_shifts: None,
            temporal_lambda: None,
            max_active_sources: None,
        },
    )]));
    request
}

fn variants() -> Vec<(&'static str, DDARequest)> {
    let mut ct = request("CT");
    ct.ct_channel_pairs = Some(vec![[0, 1], [2, 3], [4, 5]]);
    // ct_window_length and ct_window_step size the CT channel groups; CT keeps the main time grid
    let mut ct_groups = request("CT");
    ct_groups.window_parameters.ct_window_length = Some(2);
    ct_groups.window_parameters.ct_window_step = Some(1);
    let mut cd = request("CD");
    cd.cd_channel_pairs = Some(vec![[1, 0], [3, 2], [5, 4]]);
    vec![
        ("ST", request("ST")),
        ("CT pairs", ct),
        ("CT channel groups", ct_groups),
        ("CD pairs", cd),
        ("DE", request("DE")),
        ("SY", request("SY")),
        (
            "CCD AllSelected",
            ccd_request("CCD", CcdConditioningStrategy::AllSelected),
        ),
        (
            "CCDLOG AllSelected",
            ccd_request("CCDLOG", CcdConditioningStrategy::AllSelected),
        ),
        (
            "CCDPR2 AllSelected",
            ccd_request("CCDPR2", CcdConditioningStrategy::AllSelected),
        ),
        (
            "CCDSIG AllSelected",
            ccd_request("CCDSIG", CcdConditioningStrategy::AllSelected),
        ),
        (
            "MVCCD AllSelected",
            ccd_request("MVCCD", CcdConditioningStrategy::AllSelected),
        ),
    ]
}

struct Grid {
    name: &'static str,
    start: usize,
    end: usize,
    step: u32,
    /// The last window's end marker when the grid is meant to reach EOF: ROWS + 1 pads one row.
    last_marker: Option<usize>,
}

const GRIDS: [Grid; 5] = [
    Grid {
        name: "start 0 step 50",
        start: 0,
        end: 9_999,
        step: 50,
        last_marker: None,
    },
    Grid {
        name: "start 1,234 step 1",
        start: 1_234,
        end: 1_849,
        step: 1,
        last_marker: None,
    },
    Grid {
        name: "start 333 step 1,500",
        start: 333,
        end: ROWS - 1,
        step: 1_500,
        last_marker: None,
    },
    Grid {
        name: "range ends at EOF, last window pads",
        start: 17_690,
        end: ROWS - 1,
        step: 7,
        last_marker: Some(ROWS + 1),
    },
    Grid {
        name: "range ends one row before EOF",
        start: 17_689,
        end: ROWS - 2,
        step: 7,
        last_marker: Some(ROWS),
    },
];

/// Panics with `what` and the first (row, window) whose bits differ.
fn assert_bitwise(what: &str, whole: &[Vec<f64>], merged: &[Vec<f64>]) {
    assert_eq!(whole.len(), merged.len(), "{what}: row count");
    for (row, (a, b)) in whole.iter().zip(merged).enumerate() {
        assert_eq!(a.len(), b.len(), "{what}: row {row} length");
        if let Some(w) = (0..a.len()).find(|&w| a[w].to_bits() != b[w].to_bits()) {
            panic!(
                "{what}: first difference at row {row}, window {w}: {} vs {}",
                a[w], b[w]
            );
        }
    }
}

fn assert_results_bitwise(what: &str, whole: &DDAResult, merged: &DDAResult) {
    let error_values = |r: &DDAResult| vec![r.error_values.clone().unwrap()];
    assert_bitwise(
        &format!("{what} error_values"),
        &error_values(whole),
        &error_values(merged),
    );
    let (whole, merged) = (
        whole.variant_results.as_ref().unwrap(),
        merged.variant_results.as_ref().unwrap(),
    );
    assert_eq!(whole.len(), merged.len(), "{what}: variant count");
    for (a, b) in whole.iter().zip(merged) {
        let what = format!("{what} {}", a.variant_id);
        assert_eq!(a.variant_id, b.variant_id, "{what}");
        assert_bitwise(&format!("{what} q_matrix"), &a.q_matrix, &b.q_matrix);
        assert_eq!(
            a.coefficient_matrices.is_some(),
            b.coefficient_matrices.is_some(),
            "{what} coefficient_matrices"
        );
        for (k, (a, b)) in a
            .coefficient_matrices
            .iter()
            .flatten()
            .zip(b.coefficient_matrices.iter().flatten())
            .enumerate()
        {
            assert_bitwise(&format!("{what} coefficient_matrices[{k}]"), a, b);
        }
        assert_eq!(
            a.fit_error_matrix.is_some(),
            b.fit_error_matrix.is_some(),
            "{what} fit_error_matrix"
        );
        if let (Some(a), Some(b)) = (&a.fit_error_matrix, &b.fit_error_matrix) {
            assert_bitwise(&format!("{what} fit_error_matrix"), a, b);
        }
        assert_bitwise(
            &format!("{what} error_values"),
            &[a.error_values.clone().unwrap()],
            &[b.error_values.clone().unwrap()],
        );
    }
}

/// Budget in bytes for blocks of `k` windows.
fn budget(k: usize, step: usize) -> usize {
    ((k - 1) * step + MARKER) * CHANNELS * 8
}

#[test]
fn blocks_equal_single_run() {
    let signals = rossler(0x5EED_0001, ROWS);
    let recording = Recording::new(&signals);
    for (variant, base) in variants() {
        for grid in &GRIDS {
            let mut request = base.clone();
            request.time_range = TimeRange {
                start: grid.start as f64,
                end: grid.end as f64,
            };
            request.window_parameters.window_step = grid.step;
            check_block_support(&request).unwrap();
            let whole = run_request_on_matrix(&request, &signals, None).unwrap();
            let id = variant.split(' ').next().unwrap();
            let ran = whole
                .variant_results
                .iter()
                .flatten()
                .find(|v| v.variant_id == id);
            assert!(
                ran.is_some_and(|v| v.q_matrix.iter().flatten().any(|x| x.is_finite())),
                "{variant} has no finite values"
            );
            let markers = whole.error_values.as_ref().unwrap();
            let windows = markers.len();
            if let Some(last) = grid.last_marker {
                assert_eq!(*markers.last().unwrap(), last as f64, "{}", grid.name);
            }
            for blocks in [1, 3, 17] {
                let expected = blocks.min(windows);
                let k = windows.div_ceil(expected);
                let plan = plan_blocks(
                    &request,
                    ROWS as u64,
                    CHANNELS,
                    budget(k, grid.step as usize),
                )
                .unwrap();
                assert_eq!(plan.len(), expected, "{variant}, {}", grid.name);
                let mut reports = 0;
                let parts = plan
                    .iter()
                    .map(|block| {
                        let mut count = |_: &PureRustProgress| reports += 1;
                        run_block(&recording, &request, block, Some(&mut count))
                    })
                    .collect::<Result<Vec<_>>>()
                    .unwrap();
                assert!(reports >= plan.len());
                let merged = merge_blocks(parts).unwrap();
                let what = format!("{variant}, {}, {expected} blocks:", grid.name);
                assert_results_bitwise(&what, &whole, &merged);
            }
        }
    }
}

/// The `variants` requests on analysis channels 17, 3, 30 and 10 of 32, given out of order.
fn four_of_32() -> Vec<(&'static str, DDARequest)> {
    let pick = vec![17, 3, 30, 10];
    variants()
        .into_iter()
        .map(|(name, mut request)| {
            request.channels = Some(pick.clone());
            if request.ct_channel_pairs.is_some() {
                request.ct_channel_pairs = Some(vec![[17, 3], [30, 10], [3, 30]]);
            }
            if request.cd_channel_pairs.is_some() {
                request.cd_channel_pairs = Some(vec![[3, 17], [10, 30], [17, 10]]);
            }
            for config in request
                .variant_configs
                .iter_mut()
                .flat_map(|c| c.values_mut())
            {
                config.selected_channels = Some(pick.clone());
                config.cd_channel_pairs = Some(vec![[3, 17], [10, 30]]);
            }
            (name, request)
        })
        .collect()
}

#[test]
fn blocks_read_only_used_channels() {
    // 32 channels: the Rössler channels of six seeds side by side, cut to 32.
    let runs: Vec<_> = (0..6).map(|k| rossler(0x5EED_0010 + k, ROWS)).collect();
    let signals: Vec<Vec<f64>> = (0..ROWS)
        .map(|r| {
            runs.iter()
                .flat_map(|run| run[r].clone())
                .take(32)
                .collect()
        })
        .collect();
    let labels: Vec<String> = (0..32).map(|c| format!("s{c}")).collect();
    let recording = Recording::new(&signals);
    // Analysis channels 3, 10, 17 and 30; the status channel sits at recording index 2.
    let used = vec![4, 11, 18, 31];
    for (variant, mut request) in four_of_32() {
        request.time_range = TimeRange {
            start: 1_234.0,
            end: 4_321.0,
        };
        let whole = run_request_on_matrix(&request, &signals, Some(&labels)).unwrap();
        let plan = plan_blocks(&request, ROWS as u64, 32, 0).unwrap();
        recording.reads.lock().unwrap().clear();
        let parts = plan
            .iter()
            .map(|block| run_block(&recording, &request, block, None))
            .collect::<Result<Vec<_>>>()
            .unwrap();
        let reads = recording.reads.lock().unwrap().clone();
        assert_eq!(reads.len(), plan.len(), "{variant}");
        let other = reads.iter().find(|c| **c != used);
        assert!(other.is_none(), "{variant} read {other:?}");
        let merged = merge_blocks(parts).unwrap();
        assert_results_bitwise(variant, &whole, &merged);
        assert_eq!(merged.channels, whole.channels, "{variant}");
        let labels = |r: &DDAResult| -> Vec<_> {
            let variants = r.variant_results.iter().flatten();
            variants.map(|v| v.channel_labels.clone()).collect()
        };
        assert_eq!(labels(&merged), labels(&whole), "{variant}");
    }
}

#[test]
fn plan_respects_budget() {
    let mut request = request("ST");
    request.time_range = TimeRange {
        start: 333.0,
        end: (ROWS - 1) as f64,
    };
    for step in [1usize, 7, 50, 1_500] {
        request.window_parameters.window_step = step as u32;
        let windows = 1 + (ROWS - 333 - (MARKER - 1)) / step;
        for budget_bytes in [budget(1, step), budget(2, step) - 1, 1 << 20, 1 << 24] {
            let plan = plan_blocks(&request, ROWS as u64, CHANNELS, budget_bytes).unwrap();
            assert_eq!(plan.first().unwrap().w0, 0);
            assert_eq!(plan.last().unwrap().w1, windows);
            for (i, block) in plan.iter().enumerate() {
                assert!(block.w0 < block.w1, "{block:?}");
                if i > 0 {
                    assert_eq!(block.w0, plan[i - 1].w1);
                }
                assert_eq!(block.row0, (333 + block.w0 * step) as u64);
                assert_eq!(
                    block.row1,
                    ((333 + (block.w1 - 1) * step + MARKER) as u64).min(ROWS as u64)
                );
                assert!(
                    (block.row1 - block.row0) as usize * CHANNELS * 8 <= budget_bytes,
                    "{block:?} exceeds {budget_bytes} bytes"
                );
            }
        }
        // A budget below one window still plans one window per block
        let plan = plan_blocks(&request, ROWS as u64, CHANNELS, 8).unwrap();
        assert_eq!(plan.len(), windows);
        assert!(plan.iter().all(|block| block.w1 == block.w0 + 1));
    }
}

#[test]
fn too_short_range_error() {
    let mut request = request("ST");
    request.time_range = TimeRange {
        start: 100.0,
        end: (100 + MARKER - 3) as f64,
    };
    let signals = rossler(0x5EED_0001, 1_000);
    let engine = run_request_on_matrix(&request, &signals, None)
        .unwrap_err()
        .to_string();
    let planner = plan_blocks(&request, 1_000, CHANNELS, 1 << 20)
        .unwrap_err()
        .to_string();
    assert!(engine.contains("Selected range has"), "{engine}");
    assert_eq!(planner, engine);
}

#[test]
fn trccd_refused() {
    let request = ccd_request("TRCCD", CcdConditioningStrategy::AllSelected);
    assert!(check_block_support(&request).is_err());
}

#[test]
fn ccdstab_refused() {
    let request = ccd_request("CCDSTAB", CcdConditioningStrategy::AllSelected);
    assert!(check_block_support(&request).is_err());
}

#[test]
fn auto_conditioning_refused() {
    for strategy in [
        CcdConditioningStrategy::AutoTargetSparse,
        CcdConditioningStrategy::AutoSharedParents,
        CcdConditioningStrategy::AutoGroupOmp,
    ] {
        assert!(check_block_support(&ccd_request("CCD", strategy)).is_err());
    }
}

#[test]
fn plan_and_run_refuse_unsupported() {
    let signals = rossler(0x5EED_0001, 1_000);
    let recording = Recording::new(&signals);
    let request = ccd_request("TRCCD", CcdConditioningStrategy::AllSelected);
    let planned = plan_blocks(&request, 1_000, CHANNELS, 1 << 20)
        .unwrap_err()
        .to_string();
    let block = plan_blocks(
        &ccd_request("CCD", CcdConditioningStrategy::AllSelected),
        1_000,
        CHANNELS,
        1 << 20,
    )
    .unwrap()
    .remove(0);
    let ran = run_block(&recording, &request, &block, None)
        .unwrap_err()
        .to_string();
    assert!(planned.contains("TRCCD"), "{planned}");
    assert_eq!(ran, planned);
}

#[test]
fn block_outside_the_grid_refused() {
    let signals = rossler(0x5EED_0001, 1_000);
    let recording = Recording::new(&signals);
    let request = request("ST");
    let plan = plan_blocks(&request, 1_000, CHANNELS, budget(4, 50)).unwrap();
    let short = Block {
        row1: plan[0].row1 - 1,
        ..plan[0].clone()
    };
    assert!(run_block(&recording, &request, &short, None).is_err());
}

#[test]
fn block_of_matches_the_plan() {
    let mut request = request("ST");
    request.time_range.start = 333.0;
    let plan = plan_blocks(&request, ROWS as u64, CHANNELS, budget(3, 50)).unwrap();
    for block in &plan {
        assert_eq!(
            &block_of(&request, ROWS as u64, block.w0, block.w1).unwrap(),
            block
        );
    }
    let last = plan.last().unwrap();
    let all = Block {
        w0: 0,
        w1: last.w1,
        row0: plan[0].row0,
        row1: last.row1,
    };
    assert_eq!(block_of(&request, ROWS as u64, 0, last.w1).unwrap(), all);
    for (w0, w1) in [(2, 2), (3, 2), (0, last.w1 + 1)] {
        assert!(
            block_of(&request, ROWS as u64, w0, w1).is_err(),
            "{w0}..{w1}"
        );
    }
    let trccd = ccd_request("TRCCD", CcdConditioningStrategy::AllSelected);
    assert!(block_of(&trccd, ROWS as u64, 0, 1).is_err());
}

#[test]
fn validate_request_checks_every_channel_index() {
    let ccd = ccd_request("CCD", CcdConditioningStrategy::AllSelected);
    assert!(validate_request(&ccd, 4).is_ok());
    let config = |edit: fn(&mut VariantChannelConfig)| {
        let mut request = ccd.clone();
        let configs = request.variant_configs.as_mut().unwrap();
        edit(configs.get_mut("conditional_cross_dynamical").unwrap());
        request
    };
    let mut channels = request("ST");
    channels.channels = Some(vec![0, 4]);
    let mut ct = request("CT");
    ct.ct_channel_pairs = Some(vec![[4, 0]]);
    let mut cd = request("CD");
    cd.cd_channel_pairs = Some(vec![[0, 4]]);
    for request in [
        channels,
        ct,
        cd,
        config(|c| c.selected_channels = Some(vec![4])),
        config(|c| c.conditioning_channels = Some(vec![4])),
        config(|c| c.cd_channel_pairs = Some(vec![[0, 4]])),
        config(|c| c.ct_channel_pairs = Some(vec![[4, 0]])),
    ] {
        let error = validate_request(&request, 4).unwrap_err().to_string();
        assert!(error.contains("channel 4 is out of range"), "{error}");
    }
    let mut filtered = request("ST");
    filtered.preprocessing_options.lowpass = Some(40.0);
    assert!(validate_request(&filtered, 4).is_err());
}
