# DDALAB

`ddalab` is the unified Python package for DDALAB.

It ships:

- the command-line interface
- the Qt desktop application
- the shared local runtime and dataset readers
- the bundled `dda-rs` backend binary used for local DDA analysis

## Entry Points

Installing this package provides:

- `ddalab`
- `ddalab-cli`
- `ddalab-gui`

`ddalab` and `ddalab-cli` both invoke the CLI entry point. `ddalab-gui` launches the desktop application directly. All entry points are backed by the single `qt` implementation package.

## Install

```bash
cd packages/ddalab
python -m pip install .
```

Published wheels and desktop installers bundle the local `dda-rs` backend, so DDA works offline without a separate network service.

For editable or source installs, local DDA analysis also requires a working Rust toolchain with `cargo` so the bundled `dda-rs` binary can be built for your platform.

## CLI Examples

```bash
ddalab health
ddalab dataset info --file data/MG100_Seizure1.edf
ddalab dda info --json
ddalab dda validate data/MG100_Seizure1.edf --json
ddalab dda run data/MG100_Seizure1.edf --channels 0 1 2 --variants ST SY --end 30
ddalab dda batch --bids-dir data/ds003029 --variants ST --continue-on-error
```

## Python DDA Estimators

The bundled Python backend includes scalar estimators for derivative-form and
weak-form DDA. Derivative-form DDA builds delayed polynomial features
`Phi(t)` and regresses a numerical derivative of `x(t)` on those features.
Weak-form DDA uses the same delayed polynomial dictionary, but fits integrated
increments instead:

```text
x(t + Delta) - x(t) ~= integral_t^{t+Delta} Phi(s) ds @ beta
```

This avoids pointwise derivative estimation and can be preferable when
observation noise would be amplified by finite differences. Coefficients remain
on the same differential-equation scale as derivative-form DDA because both the
response and design matrix are integrated over the same window.

```python
from qt.backend.dda import DerivativeDDA, WeakFormDDA

vanilla = DerivativeDDA(degree=3, delays=[0], derivative="finite_difference")
vanilla.fit(x, dt=0.01)

weak = WeakFormDDA(
    degree=3,
    delays=[0],
    integration_window=9,
    stride=1,
    quadrature="trapezoid",
    regression="ridge",
    ridge_alpha=1e-6,
    standardize_features=True,
)
weak.fit(x, dt=0.01)
print(weak.term_names_)
print(weak.coefficients_)
```

`integration_window` and `stride` are specified in samples. Use
`integration_window_seconds` or `stride_seconds` with `dt`/`sample_rate` when
time-based settings are more convenient. The default weak-form window is
conservative: half of the smallest positive delay, with a lower bound of three
samples, or five samples for nondelayed scalar systems. Too-small windows behave
more like derivative DDA; too-large windows can blur fast dynamics.

The available quadrature rules are `trapezoid`, `left_rectangle`,
`right_rectangle`, `midpoint`, and `simpson` when SciPy is available.
`trapezoid` is the default because it is the natural continuous-time weak-form
choice for sampled trajectories. `left_rectangle` can match an Euler-stepped
simulator more closely and is useful as a discretization diagnostic, but it is
not the recommended default for continuous-time estimation.

Weak-form DDA does not universally dominate derivative DDA. It trades derivative
noise sensitivity for integration-window bias. In practice, choose
`integration_window` on a held-out validation interval by minimizing weak-form
interval prediction error, then report the selected-window result. Oracle-best
windows, selected using known synthetic coefficients, are useful for experiments
but should be treated only as upper bounds.

For noisy or ill-conditioned windows, the recommended weak-form setting is
`regression="ridge"` with `standardize_features=True`. Feature standardization is
used only internally for numerical conditioning; exposed coefficients are
back-transformed to the original feature scale, so they remain comparable to
ordinary derivative-form DDA coefficients.

## Weak-Form Sparse Additive DDA

The currently supported reliable Python estimator is polynomial `WeakFormDDA`.
`SparseAdditiveWeakFormDDA` is experimental infrastructure for nonlinear
main-effect delay discovery; use it for method development and diagnostics, not
as a replacement for polynomial weak-form DDA in production analyses.

Fixed polynomial dictionaries are interpretable but can be brittle when the
true delayed response is saturating, threshold-like, or otherwise smooth but not
well approximated by low-order monomials. `SparseAdditiveWeakFormDDA` replaces
polynomial terms with cubic B-spline response functions over candidate delays:

```text
dx/dt = c + sum_tau f_tau(x(t - tau))
```

Each response function is fit in weak form by integrating spline basis functions
over the same interval used for the observed increment. The first implementation
is scalar and main-effect only; it does not yet fit pairwise delay surfaces.
Delay selection is statistically meaningful only with group sparsity, because
all spline basis functions for one delay must enter or leave the model together.
Neighboring candidate delays can also be nearly duplicate predictors, so delay
dictionary thinning and state-coverage diagnostics are part of the estimator.

```python
from qt.backend.dda import (
    SparseAdditiveWeakFormDDA,
    stability_select_sparse_additive_weak_form,
)

model = SparseAdditiveWeakFormDDA(
    candidate_delays=[0, 10, 11, 24, 25, 40],
    n_knots=7,
    spline_degree=3,
    integration_window=9,
    stride=1,
    quadrature="trapezoid",
    regression="group_lasso",
    group_lasso_alpha=0.004,
    ridge_alpha=1e-6,
    standardize_features=True,
    thin_delays=True,
    max_delay_correlation=0.98,
)
model.fit([x_trial_1, x_trial_2, x_trial_3], dt=0.01)
print(model.selected_delays_)
print(model.group_strengths_)
print(model.delay_block_correlation_)
print(model.state_coverage_)

grid, effect = model.effect_curves_[10]
```

`fit` accepts either one scalar trajectory or a list of scalar trajectories. For
list input, spline bases are shared across trajectories and weak-form windows
are built within each trajectory only, never across trajectory boundaries.

Delay ranking is based on the L2 norm of each delay-specific spline coefficient
block. With `regression="group_lasso"`, inactive delay blocks can be driven to
zero directly. For more conservative delay selection, use stability selection
with null calibration:

```python
scores = stability_select_sparse_additive_weak_form(
    [x_trial_1, x_trial_2, x_trial_3],
    dt=0.01,
    candidate_delays=model.candidate_delays_,
    integration_window=9,
    regression="group_lasso",
    group_lasso_alpha=0.004,
    n_repeats=20,
    null_repeats=10,
    calibrate=True,
)
print(scores.selection_frequency)
print(scores.null_selection_frequency)
print(scores.calibrated_selected_delays)
```

Prefer polynomial weak-form DDA when a low-order dictionary is scientifically
meaningful and coefficient-level interpretation is the primary output. Prefer
sparse additive weak-form DDA only when the main question is whether a small set
of candidate delays has smooth nonlinear influence and the shape of that
influence is itself informative. Current limitations are scalar input, main
effects only, sensitivity to candidate-delay collinearity, dependence on broad
state coverage, and validation-dependent choices of spline, group penalty, and
stability thresholds.

## Choosing Between WeakFormDDA and SparseAdditiveWeakFormDDA

Use `WeakFormDDA` as the default estimator when the goal is robust recovery of
polynomial DDA coefficients or when the analysis must be stable without
additional model-selection diagnostics. It is the reliable general-purpose
Python estimator.

Use `SparseAdditiveWeakFormDDA` only as an experimental nonlinear-delay
estimator. A defensible sparse-additive analysis should use group-lasso delay
blocks, candidate-delay thinning, stability selection, null calibration, and
state-coverage checks. Sparse-additive delay selections should not be trusted
when instantaneous null diagnostics select delayed terms, even if interval
prediction error is competitive. The current estimator also cannot represent
pairwise or interacting nonlinear delayed effects; those require a future
pairwise-surface model rather than the current main-effect spline model.

## Desktop Development

```bash
cd packages/ddalab
./start.sh
```

The script provisions a local virtual environment, installs the unified package in editable mode, and launches the Qt application.

Qt Quick plot surfaces are available as an opt-in migration path for waveform
and DDA-result visualization. Set `DDALAB_ENABLE_QML_PLOTS=1` before launch to
embed the experimental Qt Quick surfaces while comparing them against the stable
QWidget plot path.

If you are working from source, `./start.sh` expects `cargo` to be available so it can build or refresh the bundled `dda-rs` runtime.

## Smoke Test

```bash
cd packages/ddalab
./start.sh --smoke-test
```
