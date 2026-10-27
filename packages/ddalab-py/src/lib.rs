// ddalab._core: the dda-rs engine and the `ddalab` command line for the Python package in `python/ddalab`.
use clap::Parser;
use dda_rs::cli::args::{Cli, Command};
use dda_rs::cli::commands::run::{analyze, analyze_open, job_of, request_of, Failure};
use dda_rs::cli::{exit_codes, output};
use dda_rs::document::ResultDocument;
use dda_rs::io::{open_matrix, open_recording, FileSet};
use numpy::{PyArray1, PyArray2, PyArray3, PyArrayMethods, PyReadonlyArray2};
use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;
use std::collections::BTreeMap;
use std::path::Path;

/// A refusal of the request or its input is a ValueError; a failed run a RuntimeError.
fn error_of((code, message): Failure) -> PyErr {
    if code == exit_codes::INPUT_ERROR {
        PyValueError::new_err(message)
    } else {
        PyRuntimeError::new_err(message)
    }
}

/// Runs `ddalab` with `argv` (the program name first) in this process and returns its exit code.
#[pyfunction]
fn cli(py: Python<'_>, argv: Vec<String>) -> i32 {
    py.detach(|| dda_rs::cli::main_with_args(argv))
}

/// The recording at `path`: its info as JSON, its analysis channels as `(channels, samples)` in SI units, and its
/// annotations as JSON.
#[pyfunction]
#[pyo3(signature = (path, sample_rate_hz=None))]
fn read<'py>(
    py: Python<'py>,
    path: &str,
    sample_rate_hz: Option<f64>,
) -> PyResult<(String, Bound<'py, PyArray2<f64>>, String)> {
    let opened = py.detach(|| {
        let files = FileSet::from_path(Path::new(path))?;
        let reader = open_recording(&files, sample_rate_hz)?;
        let info = reader.info();
        let channels = info.analysis_channels();
        let rows = reader.read_rows(&channels, 0, info.sample_count as usize)?;
        let (annotations, _) = reader.scan_annotations()?;
        Ok::<_, dda_rs::DDAError>((info.clone(), channels.len(), rows, annotations))
    });
    let (info, width, rows, annotations) =
        opened.map_err(|e| PyValueError::new_err(format!("{path}: {e}")))?;
    let samples = rows.len();
    let by_channel: Vec<f64> = (0..width)
        .flat_map(|c| rows.iter().map(move |row| row[c]))
        .collect();
    let data = PyArray1::from_vec(py, by_channel).reshape([width, samples])?;
    let info = serde_json::to_string(&info).expect("recording info serializes");
    let annotations = serde_json::to_string(&annotations).expect("annotations serialize");
    Ok((info, data, annotations))
}

/// One finished run: the result document `ddalab run` writes.
#[pyclass(module = "ddalab._core", frozen)]
struct Analysis {
    document: ResultDocument,
    warnings: Vec<String>,
}

type VariantArrays<'py> = (
    String,
    String,
    Vec<String>,
    Bound<'py, PyArray2<f64>>,
    Option<Bound<'py, PyArray2<f64>>>,
    Option<Bound<'py, PyArray3<f64>>>,
);

#[pymethods]
impl Analysis {
    fn document_json(&self) -> String {
        serde_json::to_string(&self.document).expect("result documents serialize")
    }

    /// Writes the document as `ddalab run -o path` does.
    fn save(&self, path: &str, compact: bool) -> PyResult<()> {
        output::write_json(&self.document, compact, Some(path))
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    fn window_centers<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_slice(py, &self.document.window_centers_seconds)
    }

    /// Per variant: id, label, row labels, Q `[row][window]`, fit error `[row][window]` and coefficients
    /// `[coefficient][row][window]` when the engine filled them.
    fn variants<'py>(&self, py: Python<'py>) -> PyResult<Vec<VariantArrays<'py>>> {
        let ragged = |e: numpy::FromVecError| PyRuntimeError::new_err(e.to_string());
        let matrix = |m: &Vec<Vec<f64>>| -> PyResult<Bound<'py, PyArray2<f64>>> {
            if m.is_empty() {
                return Ok(PyArray2::zeros(py, [0, 0], false));
            }
            PyArray2::from_vec2(py, m).map_err(ragged)
        };
        self.document
            .variants
            .iter()
            .map(|v| {
                Ok((
                    v.id.clone(),
                    v.label.clone(),
                    v.row_labels.clone(),
                    matrix(&v.matrix)?,
                    v.fit_error_matrix.as_ref().map(matrix).transpose()?,
                    v.coefficient_matrices
                        .as_ref()
                        .filter(|c| !c.is_empty())
                        .map(|c| PyArray3::from_vec3(py, c).map_err(ragged))
                        .transpose()?,
                ))
            })
            .collect()
    }

    #[getter]
    fn warnings(&self) -> Vec<String> {
        self.warnings.clone()
    }
}

/// Runs `ddalab run` as `argv` asks, on its `--file` or, with `data` `(channels, samples)`, on that array at
/// `sample_rate_hz` with channel `labels`. Returns the analysis instead of writing it.
#[pyfunction]
#[pyo3(signature = (argv, data=None, sample_rate_hz=None, labels=None))]
fn run(
    py: Python<'_>,
    argv: Vec<String>,
    data: Option<PyReadonlyArray2<'_, f64>>,
    sample_rate_hz: Option<f64>,
    labels: Option<Vec<String>>,
) -> PyResult<Analysis> {
    let cli = Cli::try_parse_from(argv).map_err(|e| PyValueError::new_err(e.to_string()))?;
    let Command::Run(args) = cli.command else {
        return Err(PyValueError::new_err(
            "run takes the arguments of `ddalab run`",
        ));
    };
    let (request, _) = request_of(&args).map_err(PyValueError::new_err)?;
    // Row-major samples, as a recording reads them.
    let matrix = match data {
        Some(data) => {
            let array = data.as_array();
            let (channels, samples) = array.dim();
            let labels =
                labels.unwrap_or_else(|| (1..=channels).map(|c| format!("Channel {c}")).collect());
            let rate = sample_rate_hz
                .ok_or_else(|| PyValueError::new_err("an array needs its sample rate"))?;
            let values: Vec<f64> = (0..samples)
                .flat_map(|s| array.column(s).to_vec())
                .collect();
            Some(
                open_matrix(labels, rate, values)
                    .map_err(|e| PyValueError::new_err(e.to_string()))?,
            )
        }
        None => None,
    };
    let analysis = py.detach(|| {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|e| (exit_codes::EXECUTION_ERROR, e.to_string()))?;
        runtime.block_on(async {
            let job = job_of(&args, request);
            match &matrix {
                // An array has no input files to hash.
                Some(reader) => {
                    let files = FileSet {
                        primary: args.file.clone(),
                        files: BTreeMap::new(),
                    };
                    analyze_open(job, &files, reader.as_ref()).await
                }
                None => analyze(job).await,
            }
        })
    });
    let analysis = analysis.map_err(error_of)?;
    Ok(Analysis {
        document: analysis.document,
        warnings: analysis.warnings,
    })
}

#[pymodule]
fn _core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    m.add_function(wrap_pyfunction!(cli, m)?)?;
    m.add_function(wrap_pyfunction!(read, m)?)?;
    m.add_function(wrap_pyfunction!(run, m)?)?;
    m.add_class::<Analysis>()?;
    Ok(())
}
