//! Structure selection and classification with DDA features: which ST model (terms and delays) separates labeled
//! segments best, and the classifier it gives.
//!
//! Features of segment s under structure S = (terms T, delays tau): ST DDA in windows of `wl` samples stepped by `ws`
//! fits, on every channel c and window w, coefficients a_{c,k,w} (k in T) and the fit error rho_{c,w};
//! f_s = (mean_w a_{c,k,w} for k in T, mean_w rho_{c,w}) for each channel c, means over the finite values.
//!
//! Classifier: linear discriminant analysis on features standardized by the training rows, with the pooled
//! within-class covariance shrunk toward a scaled identity, Sigma_l = (1 - l) Sigma + l (tr Sigma / p) I, and equal
//! class priors: the class of x is argmax_k (x' Sigma_l^-1 mu_k - mu_k' Sigma_l^-1 mu_k / 2).
//!
//! Score: balanced accuracy, the mean over classes of the recall, of the out-of-fold predictions of grouped k-fold
//! cross-validation. A group (a subject or a recording) keeps all its segments in one fold, so no fold tests on data
//! that trained it. Groups go to folds round-robin in name order.
//!
//! Search: every set of `n_terms` model terms at `delays`, then every delay pair tau1 < tau2 in `delay_range` with the
//! best terms. The search score is optimistic, since the same folds chose the structure; the nested score repeats the
//! whole search inside each outer fold and predicts the held-out fold with the structure that search chose.

use crate::engine::{model_term_count, run_request_on_matrix};
use crate::error::{DDAError, Result};
use crate::types::*;
use nalgebra::{DMatrix, DVector};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Mutex;

/// One labeled stretch of signal: `samples` are rows of the selected channels, in SI units.
pub struct Segment {
    pub label: String,
    pub group: String,
    /// Where it came from, for messages and the report: `file@start-end s`.
    pub source: String,
    pub samples: Vec<Vec<f64>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Structure {
    pub terms: Vec<i32>,
    pub delays: Vec<i32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchConfig {
    pub wl: u32,
    pub ws: u32,
    pub dm: u32,
    pub order: u32,
    pub n_terms: usize,
    /// The delays the term search runs at.
    pub delays: Vec<i32>,
    /// The smallest and largest delay of the delay search.
    pub delay_range: [i32; 2],
    pub folds: usize,
    pub shrinkage: f64,
    pub nested: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Scored {
    pub structure: Structure,
    pub score: f64,
}

/// A trained classifier: standardize by `mean` and `scale`, then the class of x is argmax_k (weights_k . x + bias_k).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Lda {
    pub classes: Vec<String>,
    pub mean: Vec<f64>,
    pub scale: Vec<f64>,
    pub weights: Vec<Vec<f64>>,
    pub bias: Vec<f64>,
}

/// What `predict` needs to classify new segments: the structure, the DDA windows, the channels and the classifier.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClassifierModel {
    pub structure: Structure,
    pub wl: u32,
    pub ws: u32,
    pub dm: u32,
    pub order: u32,
    pub channels: Vec<String>,
    /// The reference the channels were derived with; new recordings are read with it too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<crate::io::Reference>,
    pub feature_names: Vec<String>,
    pub lda: Lda,
}

/// A segment as the report lists it.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SegmentRecord {
    pub source: String,
    pub label: String,
    pub group: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Report {
    pub classes: Vec<String>,
    pub segments_per_class: BTreeMap<String, usize>,
    pub groups: usize,
    pub folds: usize,
    pub config: SearchConfig,
    /// The best structures of the search, best first.
    pub ranking: Vec<Scored>,
    pub best: Structure,
    /// Balanced accuracy of the best structure in the search's own folds: optimistic.
    pub search_score: f64,
    /// Balanced accuracy of the whole search, nested in outer folds; `None` when `nested` was off or an outer fold
    /// would leave fewer than two groups to search on.
    pub nested_score: Option<f64>,
    /// `confusion[true][predicted]`, counts of the out-of-fold predictions behind `nested_score` (or `search_score`).
    pub confusion: Vec<Vec<usize>>,
    /// The classifier of the best structure, trained on every segment.
    pub model: ClassifierModel,
    pub segments: Vec<SegmentRecord>,
}

fn invalid(message: impl Into<String>) -> DDAError {
    DDAError::InvalidParameter(message.into())
}

/// The ST request of `structure` on a matrix of `channels` columns and `rows` rows.
fn request(
    structure: &Structure,
    config: (u32, u32, u32, u32),
    channels: usize,
    rows: usize,
) -> DDARequest {
    let (wl, ws, dm, order) = config;
    DDARequest {
        file_path: String::new(),
        channels: Some((0..channels).collect()),
        time_range: TimeRange {
            start: 0.0,
            end: rows.saturating_sub(1) as f64,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["ST".to_string()],
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: wl,
            window_step: ws,
            ct_window_length: None,
            ct_window_step: None,
        },
        delay_parameters: DelayParameters {
            delays: structure.delays.clone(),
        },
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: Some(ModelParameters {
            dm,
            order,
            nr_tau: structure.delays.len() as u32,
        }),
        model_terms: Some(structure.terms.clone()),
        variant_configs: None,
        sampling_rate: None,
    }
}

/// The mean of the finite values of `row`; NaN when there are none.
fn finite_mean(row: &[f64]) -> f64 {
    let (sum, n) = row
        .iter()
        .filter(|v| v.is_finite())
        .fold((0.0, 0usize), |(s, n), v| (s + v, n + 1));
    if n == 0 {
        f64::NAN
    } else {
        sum / n as f64
    }
}

/// The features of `samples` under `structure`: per channel, the window means of each coefficient, then of rho.
pub fn features(
    structure: &Structure,
    config: (u32, u32, u32, u32),
    samples: &[Vec<f64>],
) -> Result<Vec<f64>> {
    let channels = samples.first().map_or(0, Vec::len);
    let result = run_request_on_matrix(
        &request(structure, config, channels, samples.len()),
        samples,
        None,
    )?;
    let st = result
        .variant_results
        .unwrap_or_default()
        .into_iter()
        .find(|v| v.variant_id == "ST")
        .ok_or_else(|| invalid("the ST run returned no ST result"))?;
    let coefficients = st.coefficient_matrices.unwrap_or_default();
    let errors = st.fit_error_matrix.unwrap_or_default();
    Ok((0..channels)
        .flat_map(|c| {
            let mut row: Vec<f64> = coefficients.iter().map(|k| finite_mean(&k[c])).collect();
            row.push(errors.get(c).map_or(f64::NAN, |e| finite_mean(e)));
            row
        })
        .collect())
}

/// The feature names of `structure` on `channels`: `<channel>:a<term>` for each term, then `<channel>:rho`.
pub fn feature_names(structure: &Structure, channels: &[String]) -> Vec<String> {
    channels
        .iter()
        .flat_map(|c| {
            let mut names: Vec<String> = structure
                .terms
                .iter()
                .map(|t| format!("{c}:a{t}"))
                .collect();
            names.push(format!("{c}:rho"));
            names
        })
        .collect()
}

impl Lda {
    /// Fits on `x` (one row per segment) and `y` (indices into `classes`).
    pub fn fit(x: &[Vec<f64>], y: &[usize], classes: &[String], shrinkage: f64) -> Lda {
        let (n, p, k) = (x.len(), x[0].len(), classes.len());
        // Over the finite values: a segment without one (a flat channel) counts as the mean (`standardize`).
        let finite = |j: usize| x.iter().map(move |r| r[j]).filter(|v| v.is_finite());
        let mean: Vec<f64> = (0..p)
            .map(|j| finite_mean(&finite(j).collect::<Vec<_>>()))
            .map(|m| if m.is_finite() { m } else { 0.0 })
            .collect();
        let scale: Vec<f64> = (0..p)
            .map(|j| {
                let var =
                    finite_mean(&finite(j).map(|v| (v - mean[j]).powi(2)).collect::<Vec<_>>());
                if var > 0.0 {
                    var.sqrt()
                } else {
                    1.0
                }
            })
            .collect();
        let z: Vec<Vec<f64>> = x.iter().map(|r| standardize(r, &mean, &scale)).collect();
        let class_means: Vec<DVector<f64>> = (0..k)
            .map(|c| {
                let rows: Vec<&Vec<f64>> = z
                    .iter()
                    .zip(y)
                    .filter(|(_, &yi)| yi == c)
                    .map(|(r, _)| r)
                    .collect();
                let m = rows.len().max(1) as f64;
                DVector::from_fn(p, |j, _| rows.iter().map(|r| r[j]).sum::<f64>() / m)
            })
            .collect();
        let mut within = DMatrix::<f64>::zeros(p, p);
        for (r, &c) in z.iter().zip(y) {
            let d = DVector::from_column_slice(r) - &class_means[c];
            within += &d * d.transpose();
        }
        within /= (n.saturating_sub(k)).max(1) as f64;
        let target = within.trace() / p as f64;
        let shrunk =
            within * (1.0 - shrinkage) + DMatrix::identity(p, p) * (shrinkage * target.max(1e-12));
        let inverse = shrunk
            .clone()
            .cholesky()
            .map(|c| c.inverse())
            // An SVD with a cap on its iterations: nalgebra's pseudo_inverse has none.
            .or_else(|| {
                shrunk
                    .clone()
                    .try_svd(true, true, 1e-12, 10_000)?
                    .pseudo_inverse(1e-12)
                    .ok()
            })
            .unwrap_or_else(|| DMatrix::identity(p, p));
        let weights: Vec<DVector<f64>> = class_means.iter().map(|m| &inverse * m).collect();
        Lda {
            classes: classes.to_vec(),
            bias: weights
                .iter()
                .zip(&class_means)
                .map(|(w, m)| -0.5 * w.dot(m))
                .collect(),
            weights: weights
                .iter()
                .map(|w| w.iter().copied().collect())
                .collect(),
            mean,
            scale,
        }
    }

    /// The discriminant of each class for `x`.
    pub fn scores(&self, x: &[f64]) -> Vec<f64> {
        let z = standardize(x, &self.mean, &self.scale);
        self.weights
            .iter()
            .zip(&self.bias)
            .map(|(w, b)| w.iter().zip(&z).map(|(a, b)| a * b).sum::<f64>() + b)
            .collect()
    }

    pub fn predict(&self, x: &[f64]) -> usize {
        argmax(&self.scores(x))
    }
}

fn standardize(x: &[f64], mean: &[f64], scale: &[f64]) -> Vec<f64> {
    // A feature without a finite value in a segment (a flat channel) counts as the training mean.
    x.iter()
        .zip(mean.iter().zip(scale))
        .map(|(v, (m, s))| if v.is_finite() { (v - m) / s } else { 0.0 })
        .collect()
}

fn argmax(values: &[f64]) -> usize {
    values
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map_or(0, |(i, _)| i)
}

/// The mean over the classes present in `truth` of the share of their segments predicted right.
pub fn balanced_accuracy(truth: &[usize], predicted: &[usize], classes: usize) -> f64 {
    let recalls: Vec<f64> = (0..classes)
        .filter_map(|c| {
            let of: Vec<usize> = (0..truth.len()).filter(|&i| truth[i] == c).collect();
            (!of.is_empty())
                .then(|| of.iter().filter(|&&i| predicted[i] == c).count() as f64 / of.len() as f64)
        })
        .collect();
    recalls.iter().sum::<f64>() / recalls.len().max(1) as f64
}

/// The fold of each of `members` (segment indices): their groups round-robin in name order over `folds` folds.
fn fold_of(members: &[usize], groups: &[String], folds: usize) -> HashMap<usize, usize> {
    let names: BTreeSet<&String> = members.iter().map(|&i| &groups[i]).collect();
    let fold: HashMap<&String, usize> = names
        .into_iter()
        .enumerate()
        .map(|(i, g)| (g, i % folds))
        .collect();
    members.iter().map(|&i| (i, fold[&groups[i]])).collect()
}

/// The groups among `members`.
fn group_count(members: &[usize], groups: &[String]) -> usize {
    members
        .iter()
        .map(|&i| &groups[i])
        .collect::<BTreeSet<_>>()
        .len()
}

/// Out-of-fold predictions for `members` from features `x` (all segments), labels `y` and grouped folds.
fn cross_validate(
    x: &[Vec<f64>],
    y: &[usize],
    groups: &[String],
    members: &[usize],
    config: &SearchConfig,
    classes: &[String],
) -> Vec<usize> {
    let folds = config.folds.min(group_count(members, groups));
    let fold = fold_of(members, groups, folds);
    let mut predicted = vec![0; members.len()];
    for f in 0..folds {
        let train: Vec<usize> = members.iter().copied().filter(|i| fold[i] != f).collect();
        let tx: Vec<Vec<f64>> = train.iter().map(|&i| x[i].clone()).collect();
        let ty: Vec<usize> = train.iter().map(|&i| y[i]).collect();
        let lda = Lda::fit(&tx, &ty, classes, config.shrinkage);
        for (slot, &i) in members.iter().enumerate() {
            if fold[&i] == f {
                predicted[slot] = lda.predict(&x[i]);
            }
        }
    }
    predicted
}

/// Every set of `n` terms from 1..=`count`, ascending.
fn term_sets(count: usize, n: usize) -> Vec<Vec<i32>> {
    fn grow(start: usize, count: usize, n: usize, current: &mut Vec<i32>, out: &mut Vec<Vec<i32>>) {
        if current.len() == n {
            out.push(current.clone());
            return;
        }
        for t in start..=count {
            current.push(t as i32);
            grow(t + 1, count, n, current, out);
            current.pop();
        }
    }
    let mut out = Vec::new();
    grow(1, count, n, &mut Vec::new(), &mut out);
    out
}

/// The features of every segment under each structure, computed once.
struct FeatureCache<'a> {
    segments: &'a [Segment],
    config: (u32, u32, u32, u32),
    known: Mutex<HashMap<Structure, std::sync::Arc<Vec<Vec<f64>>>>>,
}

impl FeatureCache<'_> {
    fn get(&self, structure: &Structure) -> Result<std::sync::Arc<Vec<Vec<f64>>>> {
        if let Some(found) = self.known.lock().unwrap().get(structure) {
            return Ok(found.clone());
        }
        let rows = self
            .segments
            .par_iter()
            .map(|s| {
                features(structure, self.config, &s.samples)
                    .map_err(|e| invalid(format!("{}: {e}", s.source)))
            })
            .collect::<Result<Vec<_>>>()?;
        let rows = std::sync::Arc::new(rows);
        self.known
            .lock()
            .unwrap()
            .insert(structure.clone(), rows.clone());
        Ok(rows)
    }

    /// `structures` scored by cross-validation on `members`, best first.
    fn rank(
        &self,
        structures: Vec<Structure>,
        members: &[usize],
        y: &[usize],
        groups: &[String],
        config: &SearchConfig,
        classes: &[String],
    ) -> Result<Vec<Scored>> {
        let mut scored = structures
            .into_par_iter()
            .map(|structure| {
                let x = self.get(&structure)?;
                let predicted = cross_validate(&x, y, groups, members, config, classes);
                let truth: Vec<usize> = members.iter().map(|&i| y[i]).collect();
                Ok(Scored {
                    score: balanced_accuracy(&truth, &predicted, classes.len()),
                    structure,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        // Equal scores keep the simpler structure first: lower terms and shorter delays.
        scored.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.structure.cmp(&b.structure))
        });
        Ok(scored)
    }

    /// The term search, then the delay search with the best terms, on `members`.
    fn search(
        &self,
        members: &[usize],
        y: &[usize],
        groups: &[String],
        config: &SearchConfig,
        classes: &[String],
    ) -> Result<Vec<Scored>> {
        let count = model_term_count(config.delays.len(), config.order as usize);
        let by_terms = term_sets(count, config.n_terms)
            .into_iter()
            .map(|terms| Structure {
                terms,
                delays: config.delays.clone(),
            })
            .collect();
        let terms = self.rank(by_terms, members, y, groups, config, classes)?;
        let best_terms = terms[0].structure.terms.clone();
        let [low, high] = config.delay_range;
        let by_delays = (low..=high)
            .flat_map(|a| (a + 1..=high).map(move |b| vec![a, b]))
            .map(|delays| Structure {
                terms: best_terms.clone(),
                delays,
            })
            .collect();
        let mut ranked = self.rank(by_delays, members, y, groups, config, classes)?;
        ranked.extend(terms);
        ranked.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.structure.cmp(&b.structure))
        });
        ranked.dedup_by(|a, b| a.structure == b.structure);
        Ok(ranked)
    }
}

/// Searches the structures for `segments`, scores the search, and trains the classifier of the best structure.
pub fn select(
    segments: &[Segment],
    channels: Vec<String>,
    config: SearchConfig,
    top: usize,
) -> Result<Report> {
    if config.delays.len() != 2 {
        return Err(invalid(
            "the structure search uses two delays: give --delays two values",
        ));
    }
    if config.delay_range[0] < 1 || config.delay_range[1] <= config.delay_range[0] {
        return Err(invalid("the delay range needs 1 <= min < max"));
    }
    if !(0.0..=1.0).contains(&config.shrinkage) {
        return Err(invalid("the shrinkage is between 0 and 1"));
    }
    let count = model_term_count(config.delays.len(), config.order as usize);
    if !(1..=count).contains(&config.n_terms) {
        return Err(invalid(format!(
            "--terms {} does not fit: the model of order {} has {count} terms",
            config.n_terms, config.order
        )));
    }
    let classes: Vec<String> = segments
        .iter()
        .map(|s| s.label.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if classes.len() < 2 {
        return Err(invalid(format!(
            "classification needs two classes or more; the segments have {classes:?}"
        )));
    }
    let y: Vec<usize> = segments
        .iter()
        .map(|s| classes.binary_search(&s.label).unwrap())
        .collect();
    let groups: Vec<String> = segments.iter().map(|s| s.group.clone()).collect();
    let all: Vec<usize> = (0..segments.len()).collect();
    let group_total = group_count(&all, &groups);
    if group_total < 2 || config.folds < 2 {
        return Err(invalid(format!(
            "cross-validation needs two groups (subjects or recordings) and two folds; there are {group_total} groups"
        )));
    }
    let cache = FeatureCache {
        segments,
        config: (config.wl, config.ws, config.dm, config.order),
        known: Mutex::new(HashMap::new()),
    };
    let ranking = cache.search(&all, &y, &groups, &config, &classes)?;
    let best = ranking[0].clone();

    // The nested score: each outer fold searches on the others and predicts itself with the structure it chose.
    let outer_folds = config.folds.min(group_total);
    // Round robin gives an outer fold at most ceil(groups / folds) groups; its training set then needs two groups
    // left for the inner cross-validation of the search.
    let searchable = group_total - group_total.div_ceil(outer_folds) >= 2;
    let (nested_score, predicted) = if config.nested && searchable {
        let fold = fold_of(&all, &groups, outer_folds);
        let mut predicted = vec![0; segments.len()];
        for f in 0..outer_folds {
            let train: Vec<usize> = all.iter().copied().filter(|i| fold[i] != f).collect();
            let chosen = cache
                .search(&train, &y, &groups, &config, &classes)?
                .remove(0)
                .structure;
            let x = cache.get(&chosen)?;
            let tx: Vec<Vec<f64>> = train.iter().map(|&i| x[i].clone()).collect();
            let ty: Vec<usize> = train.iter().map(|&i| y[i]).collect();
            let lda = Lda::fit(&tx, &ty, &classes, config.shrinkage);
            for &i in all.iter().filter(|i| fold[i] == f) {
                predicted[i] = lda.predict(&x[i]);
            }
        }
        (
            Some(balanced_accuracy(&y, &predicted, classes.len())),
            predicted,
        )
    } else {
        let x = cache.get(&best.structure)?;
        (
            None,
            cross_validate(&x, &y, &groups, &all, &config, &classes),
        )
    };
    let mut confusion = vec![vec![0; classes.len()]; classes.len()];
    for (&t, &p) in y.iter().zip(&predicted) {
        confusion[t][p] += 1;
    }

    let x = cache.get(&best.structure)?;
    let model = ClassifierModel {
        feature_names: feature_names(&best.structure, &channels),
        structure: best.structure.clone(),
        wl: config.wl,
        ws: config.ws,
        dm: config.dm,
        order: config.order,
        channels,
        reference: None,
        lda: Lda::fit(&x, &y, &classes, config.shrinkage),
    };
    let mut segments_per_class = BTreeMap::new();
    for s in segments {
        *segments_per_class.entry(s.label.clone()).or_insert(0) += 1;
    }
    Ok(Report {
        segments_per_class,
        groups: group_total,
        folds: outer_folds,
        search_score: best.score,
        best: best.structure,
        ranking: ranking.into_iter().take(top).collect(),
        nested_score,
        confusion,
        classes,
        config,
        model,
        segments: segments
            .iter()
            .map(|s| SegmentRecord {
                source: s.source.clone(),
                label: s.label.clone(),
                group: s.group.clone(),
            })
            .collect(),
    })
}

impl ClassifierModel {
    /// The class of `samples` (rows of `channels`) and each class's discriminant.
    pub fn classify(&self, samples: &[Vec<f64>]) -> Result<(String, Vec<f64>)> {
        let x = features(
            &self.structure,
            (self.wl, self.ws, self.dm, self.order),
            samples,
        )?;
        let scores = self.lda.scores(&x);
        Ok((self.lda.classes[argmax(&scores)].clone(), scores))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{Rng, SeedableRng};
    use rand_chacha::ChaCha8Rng;

    /// A noisy sine of `hz` at 256 Hz on two channels, `seconds` long.
    fn sine(hz: f64, seconds: usize, rng: &mut ChaCha8Rng) -> Vec<Vec<f64>> {
        (0..seconds * 256)
            .map(|i| {
                let t = i as f64 / 256.0;
                let s = (2.0 * std::f64::consts::PI * hz * t).sin();
                vec![s + 0.3 * rng.gen::<f64>(), 0.5 * s + 0.3 * rng.gen::<f64>()]
            })
            .collect()
    }

    #[test]
    fn term_sets_are_the_combinations() {
        assert_eq!(
            term_sets(4, 2),
            [
                vec![1, 2],
                vec![1, 3],
                vec![1, 4],
                vec![2, 3],
                vec![2, 4],
                vec![3, 4]
            ]
        );
    }

    #[test]
    fn balanced_accuracy_weighs_classes_equally() {
        // Class 0: 9 of 9 right; class 1: 0 of 1.
        let truth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
        assert_eq!(balanced_accuracy(&truth, &[0; 10], 2), 0.5);
    }

    #[test]
    fn lda_separates_two_clouds() {
        let x = vec![
            vec![0.0, 0.1],
            vec![0.2, 0.0],
            vec![3.0, 3.1],
            vec![3.2, 2.9],
        ];
        let lda = Lda::fit(&x, &[0, 0, 1, 1], &["a".into(), "b".into()], 0.1);
        assert_eq!(lda.predict(&[0.1, 0.1]), 0);
        assert_eq!(lda.predict(&[3.1, 3.0]), 1);
    }

    #[test]
    fn a_missing_feature_leaves_the_others_to_decide() {
        // Feature 1 has no finite value in one training segment (a flat channel's NaN).
        let x = vec![
            vec![0.0, f64::NAN],
            vec![0.2, 1.0],
            vec![3.0, 1.0],
            vec![3.2, 1.0],
        ];
        let lda = Lda::fit(&x, &[0, 0, 1, 1], &["a".into(), "b".into()], 0.1);
        assert!(lda.weights.iter().flatten().all(|w| w.is_finite()));
        assert_eq!(lda.predict(&[0.1, 1.0]), 0);
        assert_eq!(lda.predict(&[3.1, f64::NAN]), 1);
    }

    #[test]
    fn more_terms_than_the_model_has_are_refused() {
        let mut rng = ChaCha8Rng::seed_from_u64(2);
        let segments: Vec<Segment> = (0..4)
            .map(|i| Segment {
                label: ["a", "b"][i % 2].into(),
                group: format!("g{i}"),
                source: "x".into(),
                samples: sine(5.0, 2, &mut rng),
            })
            .collect();
        let config = SearchConfig {
            wl: 256,
            ws: 128,
            dm: 4,
            order: 2,
            n_terms: 6,
            delays: vec![7, 10],
            delay_range: [1, 4],
            folds: 2,
            shrinkage: 0.1,
            nested: false,
        };
        let error = select(&segments, vec!["A".into(), "B".into()], config, 3).unwrap_err();
        assert!(error.to_string().contains("terms"), "{error}");
    }

    #[test]
    fn folds_keep_a_group_together() {
        let groups: Vec<String> = ["s1", "s1", "s2", "s3", "s2"]
            .iter()
            .map(|g| g.to_string())
            .collect();
        let fold = fold_of(&[0, 1, 2, 3, 4], &groups, 2);
        assert_eq!(fold[&0], fold[&1]);
        assert_eq!(fold[&2], fold[&4]);
    }

    #[test]
    fn the_search_separates_two_rhythms() {
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        let segments: Vec<Segment> = (0..12)
            .map(|i| {
                let (label, hz) = if i % 2 == 0 {
                    ("slow", 4.0)
                } else {
                    ("fast", 20.0)
                };
                Segment {
                    label: label.into(),
                    group: format!("g{}", i / 2),
                    source: format!("seg {i}"),
                    samples: sine(hz, 4, &mut rng),
                }
            })
            .collect();
        let config = SearchConfig {
            wl: 256,
            ws: 128,
            dm: 4,
            order: 2,
            n_terms: 2,
            delays: vec![7, 10],
            delay_range: [1, 6],
            folds: 3,
            shrinkage: 0.1,
            nested: true,
        };
        let report = select(&segments, vec!["A".into(), "B".into()], config, 5).unwrap();
        assert_eq!(report.classes, ["fast", "slow"]);
        assert!(report.nested_score.unwrap() > 0.9, "{report:?}");
        assert_eq!(report.ranking.len(), 5);
        let (class, _) = report.model.classify(&sine(20.0, 4, &mut rng)).unwrap();
        assert_eq!(class, "fast");
    }

    /// Two folds over three groups leave one outer fold training on a single group, which has no inner folds:
    /// the nested score is skipped there instead of fitting on an empty training set.
    #[test]
    fn nested_scoring_skips_outer_folds_too_small_to_search() {
        let mut rng = ChaCha8Rng::seed_from_u64(3);
        let segments: Vec<Segment> = (0..6)
            .map(|i| Segment {
                label: ["slow", "fast"][i % 2].into(),
                group: format!("g{}", i / 2),
                source: format!("seg {i}"),
                samples: sine([4.0, 20.0][i % 2], 4, &mut rng),
            })
            .collect();
        let config = SearchConfig {
            wl: 256,
            ws: 128,
            dm: 4,
            order: 2,
            n_terms: 2,
            delays: vec![7, 10],
            delay_range: [1, 4],
            folds: 2,
            shrinkage: 0.1,
            nested: true,
        };
        let report = select(&segments, vec!["A".into(), "B".into()], config, 2).unwrap();
        assert!(report.nested_score.is_none(), "{report:?}");
    }

    #[test]
    fn one_group_is_refused() {
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        let segments: Vec<Segment> = ["a", "b"]
            .iter()
            .map(|l| Segment {
                label: l.to_string(),
                group: "only".into(),
                source: "x".into(),
                samples: sine(5.0, 2, &mut rng),
            })
            .collect();
        let config = SearchConfig {
            wl: 256,
            ws: 128,
            dm: 4,
            order: 2,
            n_terms: 2,
            delays: vec![7, 10],
            delay_range: [1, 4],
            folds: 5,
            shrinkage: 0.1,
            nested: false,
        };
        assert!(select(&segments, vec!["A".into(), "B".into()], config, 3)
            .unwrap_err()
            .to_string()
            .contains("two groups"));
    }
}
