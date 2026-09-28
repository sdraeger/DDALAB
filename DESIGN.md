# DDALAB Design System

## Direction

DDALAB is a visualization-first clinical workbench. A collapsible library rail
and contextual inspector frame a large central canvas. Controls are compact but
not cramped, and advanced DDA settings appear through progressive disclosure.

## Theme

The default light theme is intended for prolonged use on clinical and research
workstations. A dark theme uses the same hierarchy and semantic colors.
Surfaces use cool tinted neutrals rather than pure white or black. Cobalt is
reserved for primary actions, selection, focus, and active navigation.

## Typography

- IBM Plex Sans throughout the interface.
- 13 px body and control text.
- 12 px metadata and secondary labels.
- 16 px section titles and 20 px workspace titles.
- Weight and spacing establish hierarchy; uppercase is limited to short status
  labels where necessary.

## Layout

- 8 px base spacing unit with 4 px for tightly related items.
- 48 px command bar.
- 232 px collapsible library rail.
- Flexible central canvas with a minimum useful width of 640 px.
- 300 px contextual inspector, collapsible when visualization space is needed.
- Separators define regions; cards are reserved for genuinely independent
  content.

## Components

- Controls use a 6 px radius and a minimum 32 px height.
- Primary buttons use the accent color; secondary buttons use neutral surfaces.
- Navigation uses a quiet selected background and a leading icon or label, not
  pill tabs.
- Fields always have labels, visible focus, and inline validation.
- Empty states name the next useful action in one sentence.
- Plot controls live in a compact toolbar adjacent to the visualization.

## Motion

Use 150-200 ms ease-out transitions only for panel disclosure, selection, and
loading-state changes; the busy spinner is the only looping animation. Qt
exposes no reduced-motion setting, so motion stays short and never decorative.

## Data Visualization

Waveforms and DDA results occupy the main canvas. Rendering is viewport-aware,
at device-pixel resolution, and cached. Each waveform pixel column spans the
minimum and maximum of every sample it covers, and each heatmap pixel keeps its
largest-magnitude value, so no spike or outlier window disappears. Heatmaps,
line outputs, annotations, and cursors share one time window.
