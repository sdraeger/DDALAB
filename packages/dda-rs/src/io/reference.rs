//! Re-referencing: a reader whose analysis channels are linear combinations of another reader's, so every consumer
//! (the engine, the viewer, the command line, Python, live streams) sees the referenced signals.
//!
//! For analysis channels `x_1..x_n` of the recording, each derived channel is `y = sum_k w_k x_{s_k}`, bad when a
//! source BIDS marks bad is among its terms:
//! - average: `y_i = x_i - mean_{j in G} x_j`, G the analysis channels BIDS does not mark bad and does not type as
//!   other than a brain signal (EEG, SEEG, ECOG, DBS, MEG);
//! - bipolar: `y = x_a - x_b` for neighboring contacts. A recording with the 10-20 names of the double banana gets its
//!   chains; otherwise contacts of one shaft (the same letters, consecutive numbers: LA1, LA2) are paired;
//! - laplacian (Hjorth): `y_i = x_i - sum_j w_ij x_j` over the `neighbors` nearest electrodes j of i, `w_ij = (1/d_ij) /
//!   sum_j (1/d_ij)`, d the Euclidean distance of the positions in an electrodes TSV (`name`, `x`, `y`, `z`);
//! - custom: the rows `channel`, `source`, `weight` of a montage TSV, summed per channel.

use super::recording::*;
use super::FileSet;
use crate::error::{DDAError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

const DEFAULT_NEIGHBORS: usize = 4;

/// The reference a recording opens with. The TSVs travel as text, so a request carries everything it needs.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Reference {
    Average,
    Bipolar,
    Laplacian {
        #[serde(default = "default_neighbors")]
        neighbors: usize,
        /// An electrodes TSV; without one, the `*_electrodes.tsv` in the recording's files.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        electrodes_tsv: Option<String>,
    },
    Custom {
        montage_tsv: String,
    },
}

fn default_neighbors() -> usize {
    DEFAULT_NEIGHBORS
}

/// One weighted source of a derived channel, by the source's label.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Term {
    pub source: String,
    pub weight: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DerivedChannel {
    pub label: String,
    pub terms: Vec<Term>,
}

/// The reference and the channels it gave this recording: the provenance of a referenced result.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ResolvedReference {
    pub reference: Reference,
    pub channels: Vec<DerivedChannel>,
}

impl Reference {
    /// Parses the command line's `--reference`: `average`, `bipolar`, `laplacian`, or the text of a montage TSV.
    pub fn parse(word: &str, read: impl Fn(&str) -> Result<String>) -> Result<Reference> {
        Ok(match word {
            "average" | "avg" | "car" => Reference::Average,
            "bipolar" => Reference::Bipolar,
            "laplacian" => Reference::Laplacian {
                neighbors: DEFAULT_NEIGHBORS,
                electrodes_tsv: None,
            },
            path => Reference::Custom {
                montage_tsv: read(path)?,
            },
        })
    }
}

/// `reader` with `reference` applied: its analysis channels become the derived channels, the others follow unchanged.
pub fn with_reference(
    reader: Box<dyn Reader>,
    reference: &Reference,
    files: &FileSet,
) -> Result<Box<dyn Reader>> {
    let info = reader.info();
    let analysis = info.analysis_channels();
    let labels: Vec<&str> = analysis
        .iter()
        .map(|&i| info.channels[i].label.as_str())
        .collect();
    let derived = match reference {
        Reference::Average => average(info, &analysis),
        Reference::Bipolar => bipolar(&labels),
        Reference::Laplacian {
            neighbors,
            electrodes_tsv,
        } => {
            let text = match electrodes_tsv {
                Some(text) => text.clone(),
                None => electrodes_from(files)?,
            };
            laplacian(info, &analysis, &text, *neighbors)
        }
        Reference::Custom { montage_tsv } => custom(&labels, montage_tsv),
    }?;
    if derived.is_empty() {
        return Err(invalid("the reference gives this recording no channels"));
    }

    // Derived channel k reads analysis channels; `terms` index `analysis`.
    let unit = |terms: &[(usize, f64)]| info.channels[analysis[terms[0].0]].unit.clone();
    let mut channels: Vec<ChannelInfo> = derived
        .iter()
        .map(|(label, terms)| ChannelInfo {
            label: label.clone(),
            unit: unit(terms),
            sample_rate_hz: info.sample_rate_hz,
            gain: 1.0,
            offset: 0.0,
            kind: ChannelKind::Signal,
            // A channel derived from a bad one is bad: analyses leave it out by default.
            bids_status: terms
                .iter()
                .any(|&(a, _)| info.channels[analysis[a]].is_bad())
                .then(|| "bad".to_string()),
            bids_type: info.channels[analysis[terms[0].0]].bids_type.clone(),
        })
        .collect();
    let mut columns: Vec<Column> = derived
        .iter()
        .map(|(_, terms)| Column::Derived(terms.iter().map(|&(a, w)| (analysis[a], w)).collect()))
        .collect();
    for (i, channel) in info.channels.iter().enumerate() {
        if !analysis.contains(&i) {
            channels.push(channel.clone());
            columns.push(Column::Pass(i));
        }
    }
    let resolved = ResolvedReference {
        reference: reference.clone(),
        channels: derived
            .iter()
            .map(|(label, terms)| DerivedChannel {
                label: label.clone(),
                terms: terms
                    .iter()
                    .map(|&(a, weight)| Term {
                        source: labels[a].to_string(),
                        weight,
                    })
                    .collect(),
            })
            .collect(),
    };
    // Derived samples are physical values: their tiles keep them as f32.
    let info = RecordingInfo {
        channels,
        raw_type: RawType::F32,
        reference: Some(resolved),
        ..info.clone()
    };
    Ok(Box::new(Referenced {
        reader,
        info,
        columns,
    }))
}

fn invalid(message: impl Into<String>) -> DDAError {
    DDAError::InvalidParameter(message.into())
}

/// A derived channel: its label and `(index into the analysis channels, weight)` terms.
type Derived = (String, Vec<(usize, f64)>);

/// BIDS channel types of brain signals, which an average reference averages; an untyped channel counts as one.
const BRAIN_TYPES: [&str; 5] = ["EEG", "SEEG", "ECOG", "DBS", "MEG"];

fn average(info: &RecordingInfo, analysis: &[usize]) -> Result<Vec<Derived>> {
    let brain = |a: &usize| {
        let channel = &info.channels[analysis[*a]];
        channel
            .bids_type
            .as_deref()
            .is_none_or(|t| BRAIN_TYPES.iter().any(|b| t.eq_ignore_ascii_case(b)))
    };
    let good: Vec<usize> = (0..analysis.len())
        .filter(|&a| !info.channels[analysis[a]].is_bad() && brain(&a))
        .collect();
    if good.is_empty() {
        return Err(invalid(
            "every analysis channel is marked bad: no average to subtract",
        ));
    }
    let share = 1.0 / good.len() as f64;
    Ok((0..analysis.len())
        .map(|i| {
            let mut weights: BTreeMap<usize, f64> = good.iter().map(|&j| (j, -share)).collect();
            *weights.entry(i).or_default() += 1.0;
            let label = format!("{}-avg", info.channels[analysis[i]].label);
            (
                label,
                weights.into_iter().filter(|&(_, w)| w != 0.0).collect(),
            )
        })
        .collect())
}

/// The longitudinal bipolar ("double banana") chains, by 10-20 name; T7/T8/P7/P8 stand in for T3/T4/T5/T6.
const DOUBLE_BANANA: [[&str; 2]; 18] = [
    ["Fp1", "F7"],
    ["F7", "T3"],
    ["T3", "T5"],
    ["T5", "O1"],
    ["Fp2", "F8"],
    ["F8", "T4"],
    ["T4", "T6"],
    ["T6", "O2"],
    ["Fp1", "F3"],
    ["F3", "C3"],
    ["C3", "P3"],
    ["P3", "O1"],
    ["Fp2", "F4"],
    ["F4", "C4"],
    ["C4", "P4"],
    ["P4", "O2"],
    ["Fz", "Cz"],
    ["Cz", "Pz"],
];

/// A label without the decorations clinical systems add ("EEG Fp1-REF"), in lower case, the newer 10-20 names mapped to
/// the older ones the double banana uses.
fn electrode_name(label: &str) -> String {
    let lower = label.trim().to_ascii_lowercase();
    let bare = lower.strip_prefix("eeg ").unwrap_or(&lower);
    let bare = ["-ref", "-le", "-avg", "-a1", "-a2", "-m1", "-m2"]
        .iter()
        .find_map(|suffix| bare.strip_suffix(suffix))
        .unwrap_or(bare);
    match bare {
        "t7" => "t3",
        "t8" => "t4",
        "p7" => "t5",
        "p8" => "t6",
        name => name,
    }
    .to_string()
}

fn bipolar(labels: &[&str]) -> Result<Vec<Derived>> {
    let names: Vec<String> = labels.iter().map(|l| electrode_name(l)).collect();
    let find = |name: &str| names.iter().position(|n| n == &name.to_ascii_lowercase());
    let banana: Vec<Derived> = DOUBLE_BANANA
        .iter()
        .filter_map(|[a, b]| {
            let (i, j) = (find(a)?, find(b)?);
            Some((
                format!("{}-{}", labels[i], labels[j]),
                vec![(i, 1.0), (j, -1.0)],
            ))
        })
        .collect();
    if banana.len() >= DOUBLE_BANANA.len() / 2 {
        return Ok(banana);
    }

    // Shafts: contacts with the same letters and numbers one apart, in contact order.
    let contact = |label: &str| {
        let digits = label.len() - label.chars().rev().take_while(char::is_ascii_digit).count();
        let (shaft, number) = label.split_at(digits);
        Some((shaft.trim().to_string(), number.parse::<u32>().ok()?))
            .filter(|(shaft, _)| !shaft.is_empty())
    };
    let mut shafts: BTreeMap<String, Vec<(u32, usize)>> = BTreeMap::new();
    for (i, label) in labels.iter().enumerate() {
        if let Some((shaft, number)) = contact(label) {
            shafts.entry(shaft).or_default().push((number, i));
        }
    }
    let mut pairs = Vec::new();
    for contacts in shafts.values_mut() {
        contacts.sort();
        for pair in contacts.windows(2) {
            let [(n, i), (m, j)] = [pair[0], pair[1]];
            if m == n + 1 {
                pairs.push((
                    format!("{}-{}", labels[i], labels[j]),
                    vec![(i, 1.0), (j, -1.0)],
                ));
            }
        }
    }
    if pairs.is_empty() {
        return Err(invalid(
            "bipolar needs 10-20 names of the double banana or numbered contacts (LA1, LA2): use a custom montage",
        ));
    }
    Ok(pairs)
}

/// The rows of a TSV with a header, as maps from column to value; `#` lines and blank lines are skipped.
fn tsv(text: &str) -> Vec<BTreeMap<String, String>> {
    let mut lines = text
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'));
    let Some(header) = lines.next() else {
        return Vec::new();
    };
    let columns: Vec<String> = header
        .split('\t')
        .map(|c| c.trim().to_ascii_lowercase())
        .collect();
    lines
        .map(|line| {
            columns
                .iter()
                .cloned()
                .zip(line.split('\t').map(|v| v.trim().to_string()))
                .collect()
        })
        .collect()
}

/// The electrodes TSV among `files`: the only file whose name ends in `_electrodes.tsv`.
fn electrodes_from(files: &FileSet) -> Result<String> {
    let names: Vec<&String> = files
        .files
        .keys()
        .filter(|n| n.ends_with("_electrodes.tsv"))
        .collect();
    let name = match names[..] {
        [name] => name,
        [] => return Err(invalid(
            "laplacian needs electrode positions: an electrodes TSV (name, x, y, z) beside the recording or given with it",
        )),
        _ => return Err(invalid(format!(
            "the recording has {} electrodes TSVs (one per space): give the one to use",
            names.len()
        ))),
    };
    let source = &files.files[name];
    let mut bytes = vec![0u8; source.len() as usize];
    source.read_at(0, &mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn laplacian(
    info: &RecordingInfo,
    analysis: &[usize],
    electrodes_tsv: &str,
    neighbors: usize,
) -> Result<Vec<Derived>> {
    if neighbors == 0 {
        return Err(invalid("laplacian needs at least one neighbor"));
    }
    let positions: BTreeMap<String, [f64; 3]> = tsv(electrodes_tsv)
        .into_iter()
        .filter_map(|row| {
            let at = |c: &str| row.get(c)?.parse::<f64>().ok().filter(|v| v.is_finite());
            // 2-D layouts leave z as n/a.
            let z = row.get("z").map_or(Some(0.0), |z| {
                if z == "n/a" {
                    Some(0.0)
                } else {
                    z.parse().ok()
                }
            })?;
            Some((electrode_name(row.get("name")?), [at("x")?, at("y")?, z]))
        })
        .collect();
    let placed: Vec<(usize, [f64; 3])> = (0..analysis.len())
        .filter_map(|a| {
            let channel = &info.channels[analysis[a]];
            let position = positions.get(&electrode_name(&channel.label))?;
            Some((a, *position))
        })
        .collect();
    let usable: Vec<&(usize, [f64; 3])> = placed
        .iter()
        .filter(|(a, _)| !info.channels[analysis[*a]].is_bad())
        .collect();
    if usable.len() <= neighbors {
        return Err(invalid(format!(
            "laplacian with {neighbors} neighbors needs more than {neighbors} placed channels; the electrodes TSV places {}",
            usable.len()
        )));
    }
    let distance =
        |p: &[f64; 3], q: &[f64; 3]| (0..3).map(|k| (p[k] - q[k]).powi(2)).sum::<f64>().sqrt();
    placed
        .iter()
        .map(|(i, p)| {
            let mut near: Vec<(f64, usize)> = usable
                .iter()
                .filter(|(j, _)| j != i)
                .map(|(j, q)| (distance(p, q), *j))
                .collect();
            near.sort_by(|a, b| a.0.total_cmp(&b.0));
            near.truncate(neighbors);
            if near[0].0 == 0.0 {
                return Err(invalid(format!(
                    "two electrodes share the position of {}",
                    info.channels[analysis[*i]].label
                )));
            }
            let total: f64 = near.iter().map(|(d, _)| 1.0 / d).sum();
            let mut terms = vec![(*i, 1.0)];
            terms.extend(near.iter().map(|(d, j)| (*j, -(1.0 / d) / total)));
            Ok((format!("{}-lap", info.channels[analysis[*i]].label), terms))
        })
        .collect()
}

fn custom(labels: &[&str], montage_tsv: &str) -> Result<Vec<Derived>> {
    let mut channels: Vec<Derived> = Vec::new();
    for row in tsv(montage_tsv) {
        let field = |c: &str| {
            row.get(c).filter(|v| !v.is_empty()).ok_or_else(|| {
                invalid(format!(
                    "a montage row has no {c}: the columns are channel, source, weight"
                ))
            })
        };
        let (label, source) = (field("channel")?, field("source")?);
        let weight: f64 = field("weight")?.parse().map_err(|_| {
            invalid(format!(
                "the weight of {label} from {source} is not a number"
            ))
        })?;
        let index = labels.iter().position(|l| l == source).ok_or_else(|| {
            invalid(format!(
                "the montage names {source}, which the recording does not have"
            ))
        })?;
        match channels.iter_mut().find(|(l, _)| l == label) {
            Some((_, terms)) => terms.push((index, weight)),
            None => channels.push((label.clone(), vec![(index, weight)])),
        }
    }
    if channels.is_empty() {
        return Err(invalid(
            "the montage TSV has no rows: the columns are channel, source, weight",
        ));
    }
    Ok(channels)
}

/// Where a column of the referenced recording comes from: a weighted sum of the inner reader's channels, or one of
/// them unchanged.
enum Column {
    Derived(Vec<(usize, f64)>),
    Pass(usize),
}

struct Referenced {
    reader: Box<dyn Reader>,
    info: RecordingInfo,
    columns: Vec<Column>,
}

impl Referenced {
    /// The inner channels the derived columns among `channels` read, and their physical rows.
    fn sources(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
    ) -> Result<(Vec<usize>, Vec<Vec<f64>>)> {
        let mut needed: Vec<usize> = channels
            .iter()
            .filter_map(|&c| match &self.columns[c] {
                Column::Derived(terms) => Some(terms.iter().map(|&(s, _)| s)),
                Column::Pass(_) => None,
            })
            .flatten()
            .collect();
        needed.sort_unstable();
        needed.dedup();
        let data = if needed.is_empty() {
            Vec::new()
        } else {
            self.reader.read_rows(&needed, row0, rows)?
        };
        Ok((needed, data))
    }

    /// How the derived columns among `channels` combine the rows of `needed`: per source the weight most derived
    /// columns give it, summed once per row, and per column only its deviations from those weights. An average
    /// reference gives every source -1/n in all but one column, so a row costs O(n) instead of O(n^2).
    fn plan(&self, channels: &[usize], needed: &[usize]) -> Plan {
        let derived: Vec<&Vec<(usize, f64)>> = channels
            .iter()
            .filter_map(|&c| match &self.columns[c] {
                Column::Derived(terms) => Some(terms),
                Column::Pass(_) => None,
            })
            .collect();
        let position = |s: usize| needed.binary_search(&s).expect("needed holds every source");
        let dense = |terms: &Vec<(usize, f64)>| {
            let mut weights = vec![0.0; needed.len()];
            for &(s, w) in terms {
                weights[position(s)] += w;
            }
            weights
        };
        let weights: Vec<Vec<f64>> = derived.iter().map(|terms| dense(terms)).collect();
        let common: Vec<f64> = (0..needed.len())
            .map(|j| {
                let mut counts: HashMap<u64, usize> = HashMap::new();
                for column in &weights {
                    *counts.entry(column[j].to_bits()).or_default() += 1;
                }
                counts
                    .into_iter()
                    .max_by_key(|&(bits, count)| (count, bits == 0))
                    .map_or(0.0, |(bits, _)| f64::from_bits(bits))
            })
            .collect();
        let plain = Plan {
            shared: Vec::new(),
            columns: channels
                .iter()
                .map(|&c| match &self.columns[c] {
                    Column::Derived(terms) => {
                        Some(terms.iter().map(|&(s, w)| (position(s), w)).collect())
                    }
                    Column::Pass(_) => None,
                })
                .collect(),
        };
        let mut columns = weights.iter();
        let split = Plan {
            shared: (0..needed.len())
                .filter(|&j| common[j] != 0.0)
                .map(|j| (j, common[j]))
                .collect(),
            columns: channels
                .iter()
                .map(|&c| match self.columns[c] {
                    Column::Derived(_) => {
                        let column = columns
                            .next()
                            .expect("one weight vector per derived column");
                        Some(
                            (0..needed.len())
                                .filter(|&j| column[j] != common[j])
                                .map(|j| (j, column[j] - common[j]))
                                .collect(),
                        )
                    }
                    Column::Pass(_) => None,
                })
                .collect(),
        };
        // Split only where it at least halves the work; otherwise each column keeps its terms in their own order,
        // and its values stay bit for bit what they were.
        if 2 * split.terms() <= plain.terms() {
            split
        } else {
            plain
        }
    }
}

/// The derived columns of one read: weights by position in the rows read (see `Referenced::plan`).
struct Plan {
    shared: Vec<(usize, f64)>,
    /// Per requested channel: the deviations of a derived one, `None` for one passed through.
    columns: Vec<Option<Vec<(usize, f64)>>>,
}

impl Plan {
    /// Multiplications per row.
    fn terms(&self) -> usize {
        self.shared.len() + self.columns.iter().flatten().map(Vec::len).sum::<usize>()
    }

    fn shared(&self, row: &[f64]) -> f64 {
        self.shared.iter().map(|&(j, w)| w * row[j]).sum()
    }

    fn value(deviations: &[(usize, f64)], shared: f64, row: &[f64]) -> f64 {
        shared + deviations.iter().map(|&(j, w)| w * row[j]).sum::<f64>()
    }
}

impl Reader for Referenced {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn scan_annotations(&self) -> Result<(Vec<Annotation>, Vec<String>)> {
        self.reader.scan_annotations()
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        self.info.check_read(channels, row0, rows)?;
        let (needed, data) = self.sources(channels, row0, rows)?;
        let passed: Vec<usize> = channels
            .iter()
            .filter_map(|&c| match self.columns[c] {
                Column::Pass(s) => Some(s),
                Column::Derived(_) => None,
            })
            .collect();
        let pass_data = if passed.is_empty() {
            Vec::new()
        } else {
            self.reader.read_rows(&passed, row0, rows)?
        };
        let plan = self.plan(channels, &needed);
        Ok((0..rows)
            .map(|r| {
                let shared = if needed.is_empty() {
                    0.0
                } else {
                    plan.shared(&data[r])
                };
                let mut p = 0;
                plan.columns
                    .iter()
                    .map(|column| match column {
                        Some(deviations) => Plan::value(deviations, shared, &data[r]),
                        None => {
                            p += 1;
                            pass_data[r][p - 1]
                        }
                    })
                    .collect()
            })
            .collect())
    }

    /// Derived channels have gain 1 and offset 0, so their stored samples are the physical values.
    fn read_raw_f32(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        out: &mut [f32],
    ) -> Result<()> {
        self.info.check_read(channels, row0, rows)?;
        let width = channels.len();
        if out.len() < rows * width {
            return Err(invalid(format!(
                "a buffer of {} values for {rows} rows of {width} channels",
                out.len()
            )));
        }
        let (needed, data) = self.sources(channels, row0, rows)?;
        let plan = self.plan(channels, &needed);
        let shared: Vec<f64> = data.iter().map(|row| plan.shared(row)).collect();
        for (k, &c) in channels.iter().enumerate() {
            match &self.columns[c] {
                Column::Derived(_) => {
                    let deviations = plan.columns[k].as_deref().unwrap_or_default();
                    for r in 0..rows {
                        out[r * width + k] = Plan::value(deviations, shared[r], &data[r]) as f32;
                    }
                }
                Column::Pass(s) => {
                    let mut column = vec![0f32; rows];
                    self.reader.read_raw_f32(&[*s], row0, rows, &mut column)?;
                    for r in 0..rows {
                        out[r * width + k] = column[r];
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::open_matrix;

    fn recording(labels: &[&str], rows: &[&[f64]]) -> Box<dyn Reader> {
        let data = rows.iter().flat_map(|r| r.iter().copied()).collect();
        open_matrix(labels.iter().map(|l| l.to_string()).collect(), 100.0, data).unwrap()
    }

    fn empty() -> FileSet {
        FileSet {
            primary: "x.csv".into(),
            files: BTreeMap::new(),
        }
    }

    fn read(reader: &dyn Reader) -> (Vec<String>, Vec<Vec<f64>>) {
        let info = reader.info();
        let channels = info.analysis_channels();
        let labels = channels
            .iter()
            .map(|&c| info.channels[c].label.clone())
            .collect();
        (
            labels,
            reader
                .read_rows(&channels, 0, info.sample_count as usize)
                .unwrap(),
        )
    }

    #[test]
    fn average_subtracts_the_mean_of_the_channels() {
        let r = with_reference(
            recording(&["A", "B", "C"], &[&[1.0, 2.0, 6.0], &[0.0, 3.0, 3.0]]),
            &Reference::Average,
            &empty(),
        )
        .unwrap();
        let (labels, rows) = read(&*r);
        assert_eq!(labels, ["A-avg", "B-avg", "C-avg"]);
        let expected = [[-2.0, -1.0, 3.0], [-2.0, 1.0, 1.0]];
        for (row, want) in rows.iter().zip(expected) {
            assert!(
                row.iter().zip(want).all(|(a, b)| (a - b).abs() < 1e-12),
                "{rows:?}"
            );
        }
        let resolved = r.info().reference.as_ref().unwrap();
        assert_eq!(
            resolved.channels[0].terms[0],
            Term {
                source: "A".into(),
                weight: 1.0 - 1.0 / 3.0
            }
        );
    }

    /// 32 channels: the average reads as one mean per row plus each channel, and gives the direct sum's values.
    #[test]
    fn a_wide_average_sums_the_mean_once_per_row() {
        let labels: Vec<String> = (0..32).map(|c| format!("C{c}")).collect();
        let rows: Vec<Vec<f64>> = (0..5)
            .map(|r| (0..32).map(|c| ((r * 32 + c) as f64 * 0.7).sin()).collect())
            .collect();
        let data = rows.iter().flatten().copied().collect();
        let r = with_reference(
            open_matrix(labels, 100.0, data).unwrap(),
            &Reference::Average,
            &empty(),
        )
        .unwrap();
        let (_, referenced) = read(&*r);
        for (row, raw) in referenced.iter().zip(&rows) {
            let mean = raw.iter().sum::<f64>() / 32.0;
            for (value, x) in row.iter().zip(raw) {
                assert!((value - (x - mean)).abs() < 1e-12);
            }
        }
    }

    /// `reader` with BIDS `status` and `type` set on the channels they name.
    struct Marked {
        reader: Box<dyn Reader>,
        info: RecordingInfo,
    }

    impl Reader for Marked {
        fn info(&self) -> &RecordingInfo {
            &self.info
        }
        fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
            self.reader.read_rows(channels, row0, rows)
        }
        fn read_raw_f32(
            &self,
            channels: &[usize],
            row0: u64,
            rows: usize,
            out: &mut [f32],
        ) -> Result<()> {
            self.reader.read_raw_f32(channels, row0, rows, out)
        }
    }

    fn marked(reader: Box<dyn Reader>, bad: &[&str], types: &[(&str, &str)]) -> Box<dyn Reader> {
        let mut info = reader.info().clone();
        for channel in &mut info.channels {
            if bad.contains(&channel.label.as_str()) {
                channel.bids_status = Some("bad".into());
            }
            channel.bids_type = types
                .iter()
                .find(|(l, _)| *l == channel.label)
                .map(|(_, t)| t.to_string());
        }
        Box::new(Marked { reader, info })
    }

    #[test]
    fn a_derived_channel_of_a_bad_source_is_bad() {
        let r = marked(
            recording(&["LA1", "LA2", "LA3"], &[&[1.0, 2.0, 4.0]]),
            &["LA2"],
            &[],
        );
        let r = with_reference(r, &Reference::Bipolar, &empty()).unwrap();
        let info = r.info();
        let bad: Vec<bool> = info
            .analysis_channels()
            .iter()
            .map(|&c| info.channels[c].is_bad())
            .collect();
        assert_eq!(bad, [true, true], "both pairs read LA2");
        let r = marked(
            recording(&["A", "B", "C"], &[&[1.0, 2.0, 6.0]]),
            &["C"],
            &[],
        );
        let r = with_reference(r, &Reference::Average, &empty()).unwrap();
        let bad: Vec<bool> = r.info().channels.iter().map(|c| c.is_bad()).collect();
        assert_eq!(
            bad,
            [false, false, true],
            "only C-avg: the mean leaves C out"
        );
    }

    #[test]
    fn the_average_leaves_out_channels_typed_other_than_brain_signals() {
        let types = [("A", "EEG"), ("B", "EEG"), ("ECG", "ECG")];
        let r = marked(
            recording(&["A", "B", "ECG"], &[&[1.0, 3.0, 100.0]]),
            &[],
            &types,
        );
        let r = with_reference(r, &Reference::Average, &empty()).unwrap();
        let (_, rows) = read(&*r);
        assert_eq!(rows[0], vec![-1.0, 1.0, 98.0]);
    }

    #[test]
    fn bipolar_pairs_contacts_of_one_shaft() {
        let r = with_reference(
            recording(
                &["LA1", "LA2", "LA3", "RB2", "RB3", "ECG"],
                &[&[1.0, 2.0, 4.0, 8.0, 16.0, 0.0]],
            ),
            &Reference::Bipolar,
            &empty(),
        )
        .unwrap();
        let (labels, rows) = read(&*r);
        assert_eq!(labels, ["LA1-LA2", "LA2-LA3", "RB2-RB3"]);
        assert_eq!(rows, [vec![-1.0, -2.0, -8.0]]);
    }

    #[test]
    fn bipolar_takes_the_double_banana_on_10_20_names() {
        let names = [
            "EEG Fp1-REF",
            "EEG F7-REF",
            "EEG T7-REF",
            "EEG P7-REF",
            "EEG O1-REF",
            "EEG Fp2-REF",
            "EEG F8-REF",
            "EEG T8-REF",
            "EEG P8-REF",
            "EEG O2-REF",
            "EEG F3-REF",
            "EEG C3-REF",
            "EEG P3-REF",
            "EEG F4-REF",
            "EEG C4-REF",
            "EEG P4-REF",
        ];
        let row: Vec<f64> = (0..names.len()).map(|i| i as f64).collect();
        let r = with_reference(recording(&names, &[&row]), &Reference::Bipolar, &empty()).unwrap();
        let (labels, _) = read(&*r);
        assert_eq!(labels.len(), 16, "every chain but Fz-Cz and Cz-Pz");
        assert_eq!(labels[1], "EEG F7-REF-EEG T7-REF");
    }

    #[test]
    fn laplacian_weights_the_nearest_neighbors_by_inverse_distance() {
        let electrodes =
            "name\tx\ty\tz\nC\t0\t0\t0\nN\t0\t1\tn/a\nE\t2\t0\t0\nS\t0\t-1\t0\nW\t-4\t0\t0\n";
        let reference = Reference::Laplacian {
            neighbors: 2,
            electrodes_tsv: Some(electrodes.into()),
        };
        let r = with_reference(
            recording(&["C", "N", "E", "S", "W"], &[&[10.0, 2.0, 0.0, 4.0, 0.0]]),
            &reference,
            &empty(),
        )
        .unwrap();
        let (labels, rows) = read(&*r);
        assert_eq!(labels[0], "C-lap");
        // N and S, both at distance 1, share the weight.
        assert_eq!(rows[0][0], 10.0 - 0.5 * 2.0 - 0.5 * 4.0);
    }

    #[test]
    fn custom_sums_the_rows_of_a_montage() {
        let montage = "channel\tsource\tweight\nX\tA\t1\nX\tB\t-0.5\nX\tC\t-0.5\nY\tC\t2\n";
        let r = with_reference(
            recording(&["A", "B", "C"], &[&[4.0, 2.0, 6.0]]),
            &Reference::Custom {
                montage_tsv: montage.into(),
            },
            &empty(),
        )
        .unwrap();
        assert_eq!(
            read(&*r),
            (vec!["X".into(), "Y".into()], vec![vec![0.0, 12.0]])
        );
    }

    #[test]
    fn a_montage_naming_a_missing_channel_is_refused() {
        let error = with_reference(
            recording(&["A"], &[&[1.0]]),
            &Reference::Custom {
                montage_tsv: "channel\tsource\tweight\nX\tB\t1\n".into(),
            },
            &empty(),
        );
        assert!(error.err().unwrap().to_string().contains("does not have"));
    }

    #[test]
    fn raw_reads_of_derived_channels_are_their_physical_values() {
        let r = with_reference(
            recording(&["A", "B"], &[&[1.0, 3.0], &[5.0, 1.0]]),
            &Reference::Average,
            &empty(),
        )
        .unwrap();
        assert_eq!(r.info().raw_type, RawType::F32);
        let mut out = [0f32; 4];
        r.read_raw_f32(&[0, 1], 0, 2, &mut out).unwrap();
        assert_eq!(out, [-1.0, 1.0, 2.0, -2.0]);
    }

    #[test]
    fn the_reference_survives_json() {
        let reference = Reference::Laplacian {
            neighbors: 4,
            electrodes_tsv: None,
        };
        let json = serde_json::to_string(&reference).unwrap();
        assert_eq!(json, r#"{"kind":"laplacian","neighbors":4}"#);
        assert_eq!(
            serde_json::from_str::<Reference>(r#"{"kind":"laplacian"}"#).unwrap(),
            reference
        );
    }
}
