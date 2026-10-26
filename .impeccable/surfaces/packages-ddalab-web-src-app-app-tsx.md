---
version: 1
slug: "packages-ddalab-web-src-app-app-tsx"
primary_target: "packages/ddalab-web/src/app/App.tsx"
related_targets: []
---

## Surface

DDALAB workbench (packages/ddalab-web). Mode: Operate. Clinicians and physiological-data researchers open a recording, find the interval that matters, run DDA on chosen channels, read the result against the signal, and keep a reproducible record. Long sessions on desktop displays, some in dim reading rooms. Proof: ds003029 sub-pt01 run 1 opened by URL, an ST heatmap aligned to its waveform, provenance one click away. Constraints live in the spec (docs/superpowers/specs/2026-10-24-ddalab-web-design.md).

## Direction contract

THESIS: The clinical review workstation, executed quietly, that knows where you are in a long recording and which electrode each row belongs to. It refuses the dark neon scientific dashboard and the card grid.

OWN-WORLD: The category standard's chrome and system UI font stack: white trace area, light gray chrome #F1F3F5 with #DEE2E6 hairlines, ink #1E2A33, muted #56636E, black traces, one primary and selection blue #2F6A9E, event red #B4372B. Electrode-group tints, light and only in marks: ATT #9FC7B4, PST #A9C4E2, G #E6C79A (further groups from the same light family). Two type sizes in dense panes, rank by weight and small-caps acronyms. Batlow heatmap with a labeled colour bar. Dividers are elegant and sparse: 1 px hairlines in the chrome tone, spacing and alignment do most of the separating, and inline metadata is set as labeled fields or separated by space and a thin rule, never by runs of middle dots (the user asked for no overuse of ·). A dark theme mirrors every role.

STORY: The visitor sees the whole recording and exactly which part they are reading, trusts the scale because it is printed on the plot, picks channels by electrode group, runs DDA on the selection, and reads the heatmap on the same time axis as the traces.

FIRST VIEWPORT: Command bar on top (recording name, epoch, sensitivity, timebase, paging, Run, and at its far right a discreet icon-only light/dark toggle with an accessible label that follows the system setting until the user flips it and remembers the choice). Library rail on the left. Center: the overview locator strip with the current view outlined and its range tab, the waveform pane with group tint bars in the label gutter and the printed scale-bar block in a band at its lower left, the heatmap below on the same axis with matching tint bars. Inspector on the right with channel groups (swatch, acronym, count), DDA settings, and the run bar stating windows, blocks and workers.

FORM: User-pinned fusion of the assigned Atlas Plate (own list position 3: electrode-group tint and acronyms), the pick Survey Sheet (position 1: locator inset and printed scale bar) and the category standard (layout, font, calm); signature moves: the locator strip and the printed scale bar, with group tint marks as the one shape language across rail, waveform and heatmap. seed:c22d40eaad051c6c

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

Paging through a 24-hour recording while the locator outline walks along the overview and the printed scale bar stays true.

## Unresolved

Exact dark theme values (derive from the same roles for reading-room use; the toggle is pinned by the user); icon set (a small line-icon set, e.g. lucide-react, chosen in Task 5).
