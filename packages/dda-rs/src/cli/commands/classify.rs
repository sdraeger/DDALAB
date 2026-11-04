//! `ddalab classify` and `ddalab predict`: labeled segments from a table, annotations or a participants column, the
//! structure search and classifier of `crate::classify`, and the classes of new recordings.

use super::reference_of;
use crate::classify::{select, ClassifierModel, Report, SearchConfig, Segment};
use crate::cli::args::{ClassifyArgs, PredictArgs};
use crate::cli::{exit_codes, output};
use crate::io::{open_referenced, FileSet, Reader, Reference};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

/// An open recording and the indices in `info.channels` of the model's channels.
struct Opened {
    reader: Box<dyn Reader>,
    channels: Vec<usize>,
}

fn open(
    file: &str,
    sr: Option<f64>,
    reference: Option<&Reference>,
) -> Result<Box<dyn Reader>, String> {
    FileSet::from_path(Path::new(file))
        .and_then(|files| open_referenced(&files, sr, reference))
        .map_err(|e| format!("{file}: {e}"))
}

/// The indices of `labels` among the analysis channels of `reader`; an error names the ones it lacks.
fn find_channels(reader: Box<dyn Reader>, labels: &[String], file: &str) -> Result<Opened, String> {
    let info = reader.info();
    let analysis = info.analysis_channels();
    let found: Vec<Option<usize>> = labels
        .iter()
        .map(|l| {
            analysis
                .iter()
                .copied()
                .find(|&i| info.channels[i].label == *l)
        })
        .collect();
    let missing: Vec<&String> = labels
        .iter()
        .zip(&found)
        .filter(|(_, f)| f.is_none())
        .map(|(l, _)| l)
        .collect();
    if !missing.is_empty() {
        return Err(format!("{file} has no analysis channel {missing:?}"));
    }
    Ok(Opened {
        channels: found.into_iter().flatten().collect(),
        reader,
    })
}

/// The subject of `file` (`sub-<label>` in its path), else its name: the group its segments keep together.
fn group_of(file: &str) -> String {
    let path = Path::new(file);
    path.components()
        .rev()
        .filter_map(|c| c.as_os_str().to_str())
        .find_map(|c| {
            c.split('_')
                .find(|part| part.starts_with("sub-"))
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            path.file_name()
                .map_or(file.to_string(), |n| n.to_string_lossy().into_owned())
        })
}

/// The rows of a TSV with a header, as maps from column to value.
fn tsv(path: &str) -> Result<Vec<BTreeMap<String, String>>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let mut lines = text
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.trim().is_empty());
    let header: Vec<String> = lines
        .next()
        .ok_or_else(|| format!("{path} is empty"))?
        .split('\t')
        .map(|c| c.trim().to_string())
        .collect();
    Ok(lines
        .map(|line| {
            header
                .iter()
                .cloned()
                .zip(line.split('\t').map(|v| v.trim().to_string()))
                .collect()
        })
        .collect())
}

/// `[start, end)` cut into whole segments of `length` seconds, at most `max` of them, evenly spaced.
fn cuts(start: f64, end: f64, length: f64, max: usize) -> Vec<f64> {
    let n = ((end - start) / length).floor().max(0.0) as usize;
    if n <= max || max == 0 {
        return (0..n.min(if max == 0 { n } else { max }))
            .map(|i| start + i as f64 * length)
            .collect();
    }
    (0..max)
        .map(|i| start + ((i * (n - 1)) as f64 / (max - 1).max(1) as f64).round() * length)
        .collect()
}

/// A segment of `length` seconds from `at` on the model's channels, rows of SI values.
fn read_segment(opened: &Opened, at: f64, length: f64) -> Result<Vec<Vec<f64>>, String> {
    let rate = opened.reader.info().sample_rate_hz;
    let row0 = (at * rate).round() as u64;
    let rows = (length * rate).round() as usize;
    opened
        .reader
        .read_rows(&opened.channels, row0, rows)
        .map_err(|e| e.to_string())
}

/// Labeled stretches of one recording: `(label, start, end)` in seconds.
type Stretches = Vec<(String, f64, f64)>;

/// The stretches the annotations of `reader` give the classes `specs` (and `rest`), `segment` long at least.
fn annotated(
    reader: &dyn Reader,
    specs: &[(String, String)],
    rest: Option<&str>,
    segment: f64,
    max: usize,
) -> Result<Stretches, String> {
    let (annotations, _) = reader.scan_annotations().map_err(|e| e.to_string())?;
    let duration = reader.info().duration_s;
    let mut stretches: Stretches = annotations
        .iter()
        .filter_map(|a| {
            let text = a.label.to_lowercase();
            let (class, _) = specs
                .iter()
                .find(|(_, needle)| text.contains(needle.as_str()))?;
            Some((
                class.clone(),
                a.onset_s,
                (a.onset_s + a.duration_s.max(segment)).min(duration),
            ))
        })
        .collect();
    if let Some(rest) = rest {
        let events: usize = stretches
            .iter()
            .map(|(_, s, e)| ((e - s) / segment).floor() as usize)
            .sum();
        // Free time: more than a segment away from every annotation, of any text.
        let mut busy: Vec<(f64, f64)> = annotations
            .iter()
            .map(|a| (a.onset_s - segment, a.onset_s + a.duration_s + segment))
            .collect();
        busy.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut free = Vec::new();
        let mut at = 0.0;
        for (s, e) in busy {
            if s > at {
                free.push((at, s));
            }
            at = at.max(e);
        }
        free.push((at, duration));
        let starts: Vec<f64> = free
            .iter()
            .flat_map(|&(s, e)| cuts(s, e, segment, usize::MAX))
            .collect();
        let want = if events > 0 { events } else { max };
        let picked = cuts(0.0, starts.len() as f64, 1.0, want);
        stretches.extend(picked.iter().map(|&i| {
            (
                rest.to_string(),
                starts[i as usize],
                starts[i as usize] + segment,
            )
        }));
    }
    Ok(stretches)
}

/// The labeled segments `args` describe, and the channel labels they hold.
fn segments(
    args: &ClassifyArgs,
    reference: Option<&Reference>,
    progress: bool,
) -> Result<(Vec<Segment>, Vec<String>), String> {
    // (file, group, stretches; None: from annotations or the whole recording)
    let mut plan: Vec<(String, String, Option<Stretches>)> = Vec::new();
    if let Some(samples) = &args.samples {
        let mut by_file: BTreeMap<String, (String, Stretches)> = BTreeMap::new();
        for row in tsv(samples)? {
            let get = |c: &str| row.get(c).filter(|v| !v.is_empty() && *v != "n/a").cloned();
            let file = get("file").ok_or_else(|| format!("{samples}: a row has no file"))?;
            let label =
                get("label").ok_or_else(|| format!("{samples}: the row of {file} has no label"))?;
            let number = |c: &str| {
                get(c)
                    .map(|v| {
                        v.parse::<f64>()
                            .map_err(|_| format!("{samples}: {c} {v} is not a number"))
                    })
                    .transpose()
            };
            let (start, end) = (
                number("start")?.unwrap_or(0.0),
                number("end")?.unwrap_or(f64::INFINITY),
            );
            let group = get("group").unwrap_or_else(|| group_of(&file));
            by_file
                .entry(file)
                .or_insert_with(|| (group, Vec::new()))
                .1
                .push((label, start, end));
        }
        plan.extend(
            by_file
                .into_iter()
                .map(|(file, (group, s))| (file, group, Some(s))),
        );
    } else if let Some(participants) = &args.participants {
        let column = args.column.as_deref().unwrap_or_default();
        let rows = tsv(participants)?;
        let label_of: BTreeMap<String, String> = rows
            .iter()
            .filter_map(|r| Some((r.get("participant_id")?.clone(), r.get(column)?.clone())))
            .filter(|(_, v)| !v.is_empty() && v != "n/a")
            .collect();
        for file in args.files.iter().flatten() {
            let group = group_of(file);
            let label = label_of
                .get(&group)
                .ok_or_else(|| format!("{participants} has no {column} for {group} ({file})"))?;
            plan.push((
                file.clone(),
                group,
                Some(vec![(label.clone(), 0.0, f64::INFINITY)]),
            ));
        }
    } else {
        plan.extend(
            args.files
                .iter()
                .flatten()
                .map(|f| (f.clone(), group_of(f), None)),
        );
    }
    let specs: Vec<(String, String)> = args
        .classes
        .iter()
        .flatten()
        .map(|c| match c.split_once('=') {
            Some((name, text)) => (name.to_string(), text.to_lowercase()),
            None => (c.clone(), c.to_lowercase()),
        })
        .collect();

    let mut labels = args.channels.clone();
    let mut out = Vec::new();
    for (file, group, stretches) in plan {
        let reader = open(&file, args.sr, reference)?;
        let chosen = labels.get_or_insert_with(|| {
            let info = reader.info();
            info.analysis_channels()
                .into_iter()
                .filter(|&i| !info.channels[i].is_bad())
                .map(|i| info.channels[i].label.clone())
                .collect()
        });
        let opened = find_channels(reader, chosen, &file)?;
        let duration = opened.reader.info().duration_s;
        let stretches = match stretches {
            Some(s) => s,
            None => annotated(
                &*opened.reader,
                &specs,
                args.rest.as_deref(),
                args.segment,
                args.max_segments,
            )?,
        };
        let before = out.len();
        for (label, start, end) in stretches {
            for at in cuts(
                start.max(0.0),
                end.min(duration),
                args.segment,
                args.max_segments,
            ) {
                out.push(Segment {
                    samples: read_segment(&opened, at, args.segment)?,
                    source: format!("{file}@{at:.2}-{:.2} s", at + args.segment),
                    label: label.clone(),
                    group: group.clone(),
                });
            }
        }
        if progress {
            eprintln!("  {file}: {} segments", out.len() - before);
        }
    }
    let labels = labels.unwrap_or_default();
    if out.is_empty() {
        return Err(
            "no labeled segment: check the labels, the annotations and --segment".to_string(),
        );
    }
    Ok((out, labels))
}

/// The report of `ddalab classify` for `args`, its model reading recordings with the reference `args` name.
pub fn train(args: &ClassifyArgs) -> Result<Report, String> {
    let reference = reference_of(&args.reference)?;
    let (segments, channels) = segments(args, reference.as_ref(), !args.quiet)?;
    let config = SearchConfig {
        wl: args.wl,
        ws: args.ws,
        dm: args.dm,
        order: args.order,
        n_terms: args.terms,
        delays: args.delays.clone(),
        delay_range: [args.delay_range[0], args.delay_range[1]],
        folds: args.folds,
        shrinkage: args.shrinkage,
        nested: !args.no_nested,
    };
    if !args.quiet {
        eprintln!(
            "Searching structures on {} segments of {} channels",
            segments.len(),
            channels.len()
        );
    }
    let mut report = select(&segments, channels, config, args.top).map_err(|e| e.to_string())?;
    report.model.reference = reference;
    if !args.quiet {
        let nested = report
            .nested_score
            .map_or(String::new(), |s| format!(", nested {s:.3}"));
        eprintln!(
            "Best: terms {:?}, delays {:?}; balanced accuracy {:.3} in the search{nested}",
            report.best.terms, report.best.delays, report.search_score
        );
    }
    Ok(report)
}

/// What `ddalab predict` writes for `args`: each file's class by majority, its votes and every segment's class.
pub fn predictions(args: &PredictArgs) -> Result<Value, String> {
    let model = load_model(&args.model)?;
    let mut files = Vec::new();
    for file in &args.files {
        let opened = find_channels(
            open(file, args.sr, model.reference.as_ref())?,
            &model.channels,
            file,
        )?;
        let duration = opened.reader.info().duration_s;
        let mut votes: BTreeMap<String, usize> = BTreeMap::new();
        let mut segments = Vec::new();
        for at in cuts(0.0, duration, args.segment, 0) {
            let samples = read_segment(&opened, at, args.segment)?;
            let (class, scores) = model
                .classify(&samples)
                .map_err(|e| format!("{file}@{at} s: {e}"))?;
            *votes.entry(class.clone()).or_default() += 1;
            segments.push(json!({ "start_s": at, "end_s": at + args.segment, "class": class, "scores": scores }));
        }
        let class = votes
            .iter()
            .max_by_key(|(_, n)| **n)
            .map(|(c, _)| c.clone());
        files.push(json!({ "file": file, "class": class, "votes": votes, "segments": segments }));
    }
    Ok(json!({ "classes": model.lda.classes, "files": files }))
}

/// The model in `path`: a report's `model`, or a model alone.
fn load_model(path: &str) -> Result<ClassifierModel, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
    let model = value.get("model").cloned().unwrap_or(value);
    serde_json::from_value(model).map_err(|e| format!("{path} holds no classifier model: {e}"))
}

/// Writes `value` to `path` (stdout without one): 0, or the exit code of the failure, its message on stderr.
fn finish<T: serde::Serialize>(value: Result<T, String>, path: Option<&str>) -> i32 {
    let fail = |error: String, code| {
        eprintln!("Error: {error}");
        code
    };
    match value {
        Ok(value) => match output::write_json(&value, false, path) {
            Ok(()) => exit_codes::SUCCESS,
            Err(e) => fail(e, exit_codes::EXECUTION_ERROR),
        },
        Err(e) => fail(e, exit_codes::INPUT_ERROR),
    }
}

pub fn execute(args: ClassifyArgs) -> i32 {
    finish(train(&args), Some(&args.output))
}

pub fn predict(args: PredictArgs) -> i32 {
    finish(predictions(&args), args.output.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_fill_a_stretch_and_space_a_long_one() {
        assert_eq!(cuts(0.0, 35.0, 10.0, 20), [0.0, 10.0, 20.0]);
        assert_eq!(cuts(0.0, 100.0, 10.0, 3), [0.0, 50.0, 90.0]);
        assert_eq!(cuts(5.0, 9.0, 10.0, 3), Vec::<f64>::new());
    }

    #[test]
    fn the_group_is_the_subject() {
        assert_eq!(
            group_of("/data/sub-07/ses-1/eeg/sub-07_ses-1_task-rest_eeg.edf"),
            "sub-07"
        );
        assert_eq!(group_of("/data/patient3.edf"), "patient3.edf");
    }
}
