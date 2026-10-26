---
name: DDALAB
description: A quiet clinical review workbench for reading long physiological recordings and their DDA results on one time axis.
colors:
  primary: "#2f6a9e"
  primary-ink: "#ffffff"
  primary-wash: "rgb(47 106 158 / 0.1)"
  focus: "#2f6a9e"
  event: "#b4372b"
  event-ink: "#ffffff"
  ground: "#ffffff"
  chrome: "#f1f3f5"
  chrome-hover: "#e6e9ec"
  hairline: "#dee2e6"
  grid: "#eceff2"
  ink: "#1e2a33"
  muted: "#56636e"
  trace: "#000000"
  group-1: "#9fc7b4"
  group-2: "#a9c4e2"
  group-3: "#e6c79a"
  group-4: "#d7b5cb"
  group-5: "#c6c0e4"
  group-6: "#a7d1d3"
  group-7: "#d8cf9c"
  group-8: "#e4b7a5"
  batlow-low: "#011959"
  batlow-high: "#faccfa"
  vik-low: "#001261"
  vik-mid: "#ece5e0"
  vik-high: "#590008"
typography:
  section:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
    fontFeature: "tnum"
  body-strong:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
  label:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  label-caps:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.06em"
    fontFeature: "c2sc, smcp"
  digest:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  small: "3px"
  default: "5px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
components:
  button:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "0 12px"
    height: "28px"
  button-hover:
    backgroundColor: "{colors.chrome-hover}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.default}"
    padding: "0 12px"
    height: "28px"
  button-quiet:
    textColor: "{colors.primary}"
    rounded: "{rounded.default}"
    padding: "0 8px"
    height: "28px"
  icon-button:
    textColor: "{colors.muted}"
    rounded: "{rounded.default}"
    size: "28px"
  icon-button-hover:
    backgroundColor: "{colors.chrome-hover}"
    textColor: "{colors.ink}"
  select-trigger:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "0 4px 0 8px"
    height: "26px"
  text-field:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.default}"
    padding: "0 8px"
    height: "28px"
  menu-item-highlighted:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.small}"
    padding: "3px 8px"
  popover:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "16px"
    width: "340px"
  rail-entry-current:
    backgroundColor: "{colors.primary-wash}"
    rounded: "{rounded.default}"
    padding: "4px 8px"
  command-bar:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink}"
    height: "44px"
    padding: "0 8px"
  recording-tab:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink}"
    height: "32px"
  recording-tab-selected:
    backgroundColor: "{colors.ground}"
---

# Design System: DDALAB

## Overview

**Creative North Star: "The Quiet Review Station"**

DDALAB is the clinical review workstation of its category, executed quietly. A white trace area sits inside light gray chrome, framed by hairlines, with the library rail on the left, the inspector on the right and a 44 px command bar across the top. The system knows where the reader is in a long recording (the overview locator strip with its outlined view and range tab) and which electrode each row belongs to (group tint bars in the label gutters of the waveform and the heatmap). The scale is printed on the plot itself, in a band at the waveform's lower left.

Density is high and calm. Dense panes use two type sizes and rank by weight; section names and electrode acronyms are set in small capitals. Separation comes from spacing and alignment first, then 1 px hairlines in the chrome tone. There is one accent, a cobalt for action, selection and focus, and one alarm color for events and destructive actions. The heatmaps use Crameri's perceptually uniform maps with a labeled color bar. A dark theme for dim reading rooms mirrors every role through `light-dark()` pairs; it follows the system until the user flips the toggle at the bar's far right.

The world rejects the dark neon scientific dashboard and the card grid.

**Key Characteristics:**
- Gray chrome around a white trace area, divided by 1 px hairlines.
- One cobalt accent; event red for events, errors and Delete.
- Electrode-group tints, light, used only in marks.
- The system UI font stack with tabular numerals everywhere.
- The locator strip and the printed scale bar as the signature moves.
- One motion token pair for every transition, with view-transition crossfades for layout changes.

## Colors

A cool neutral chrome carries the interface; color is spent on the cobalt accent, the event red, the electrode tints and the data maps. Every role is a `light-dark()` pair in `tokens.css`; the frontmatter records the light value and `.impeccable/design.json` holds the full pair.

### Primary
- **Clinical Cobalt** (`primary`): primary buttons (Open files, Run DDA), selected channel labels, the selected tab's 2 px top edge, the active result tab, link text, quiet buttons, highlighted menu items and the text selection. `primary-wash` tints the current rail entry. `focus` draws the 2 px focus outline; it matches the primary in light and runs a step lighter in dark.

### Secondary
- **Event Red** (`event`): the file's events on the ruler and overview, the state point of the logo, error text and the destructive Delete action. It never decorates.

### Tertiary
- **Electrode Group Tints** (`group-1` to `group-8`): sage, sky, sand, mauve, lavender, aqua, straw and clay. One per electrode group in order; groups past the eighth repeat the family. They appear as the tint bars in the waveform and heatmap label gutters and as the 10 px swatches in the inspector's channel groups.
- **Crameri Maps**: batlow for sequential arrays in both themes; vik for signed arrays (centered at zero) in light and berlin in dark, whose dark middle keeps a near-zero cell off a glare. The frontmatter keeps the batlow and vik endpoints the color bar draws from; the full 256-entry tables live in `src/render/colormaps.ts`.

### Neutral
- **Trace Ground** (`ground`): the trace area, the heatmap, the selected recording tab, fields, buttons and popovers.
- **Chrome Gray** (`chrome`): the command bar, the library rail, the inspector, the tab strip and the page behind them. `chrome-hover` is the hover fill of rows, tabs and buttons.
- **Hairline** (`hairline`): every divider, every field and button border, and the thin rules between control groups. `grid` draws the plot gridlines one step lighter.
- **Ink** (`ink`): text, the locator outline and its range tab, user annotations and the tooltip fill.
- **Muted Slate** (`muted`): labels, counts, metadata and icon buttons at rest.
- **Trace Black** (`trace`): the waveform traces; light gray in dark.

### Named Rules
**The One Accent Rule.** Cobalt is the only hue that means "act" or "selected". A second accent never enters the chrome.

**The Tints Are Marks Rule.** Group tints fill bars and swatches only. They never fill text, rows, panels or buttons.

**The Red Means Event Rule.** Event red marks recorded events, errors and destruction. Status that is not alarming stays in ink or muted.

## Typography

**Body Font:** the system UI stack (system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif)

**Mono Font:** the system monospace stack (ui-monospace, SFMono-Regular, Menlo, monospace), for the digest role only.

**Character:** The platform's own face, set small and dense, so the workbench reads as a native instrument. Numerals are tabular throughout (`font-variant-numeric: tabular-nums` on the body), so paging and counters never shift.

### Hierarchy
- **Section** (600, 15 px): the inspector's result title, popover titles (Local, About, Calibration), history detail headings and the narrow-window notice.
- **Body** (400, 13 px, 18 px leading): controls, values and rail entries. **Body strong** (600) ranks within a pane: the wordmark, field values that lead, popover subheadings.
- **Label** (400, 12 px, 16 px leading): field labels, counts, metadata lines, hints, tooltips and errors.
- **Label caps** (600, 12 px, all small caps, 0.05 to 0.06 em tracking): section names of the rail and inspector (Recent, Folder, OpenNeuro, History, Input files), result tabs and electrode acronyms beside their swatches. Each one is the heading or name itself.
- **Digest** (400, 12 px mono, 16 px leading, wrapped anywhere): the SHA-256 digests (muted) and the command line in a result's provenance, which the reader compares and copies.

### Named Rules
**The Two Sizes Rule.** A dense pane uses 13 px and 12 px and ranks by weight. The 15 px section size heads a pane or popover and appears once in it.

**The Labeled Field Rule.** Inline metadata is set as labeled fields or separated by space and a thin vertical hairline. Runs of middle dots are never used as separators.

## Layout

The shell is a grid: a 44 px command bar across the top, then the library rail (248 px), the center and the inspector (304 px). Either side panel closes to zero width and stays mounted. The center stacks the 32 px recording tab strip, the 64 px overview locator strip, the waveform pane with its printed scale band and the heatmap on the same time axis. Overview, waveform and heatmap share one 76 px label gutter and a reserved scrollbar gutter, which keeps every time axis aligned. Each waveform row draws its trace inside its own band, so a trace taller than its row never covers a neighbor: an excursion beyond the band draws along the band's edge, and a channel off scale throughout reads as a line at the edge, never as a gap or an empty row.

Spacing runs on a 4 px unit (`spacing.1` to `spacing.6`). Rail sections sit 24 px apart with 16 px and 12 px insets; controls group at 8 px; control groups in the bar are split by a 20 px hairline rule.

The command bar collapses by window width alone, so zooming moves nothing. Sensitivity, timebase and epoch sit in the bar while it has room and go behind one Scale button below 1440 px, or below 1600 px when the inspector is closed. Below 1024 px the wordmark and the Local and Annotate labels give way to their icons. Below 768 px the shell is replaced by a short notice that the workbench needs a wider window. Only the recording name and the run status shrink; the name elides in the middle and keeps its tail.

A last grid row under the panels holds the update notice. It has no height until a new version is ready.

**The Shared Axis Rule.** Every pane that plots time reserves the same label gutter and scrollbar gutter as the waveform. A new time pane aligns to it or does not ship.

## Elevation & Depth

The workbench is flat. Depth comes from tone (gray chrome against the white trace area) and hairlines. Shadows appear only on what floats over the layout and closes again.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 6px 20px rgb(15 25 35 / 0.14)`): menus, selects, the Local and settings popovers and the annotation editor.
- **Dialog** (`box-shadow: 0 12px 32px rgb(15 25 35 / 0.2)`): the quick tab switcher, the one modal surface.
- **Lifted tab** (`box-shadow: 0 2px 8px rgb(15 25 35 / 0.14)`): a recording tab while it is dragged.

### Named Rules
**The Flat Panes Rule.** Panels, rails, rows and the bar carry no shadow. Shadow means "floating and dismissible".

## Shapes

Corners are gently rounded: 5 px on buttons, fields, selects, popovers and rail entries; 3 px on tooltips; 2 px on the small marks (group swatches, the locator outline and its range tab, ruler flags). Borders are 1 px hairlines. A selected tab is marked by an inset 2 px cobalt top edge and joins the trace area below it, the hairline under the strip giving way beneath it.

**The Echo Mark.** The logo is a D with a delay-embedding loop cut from it, an event-red state point on the loop and a cobalt echo of the bowl one delay to the right. It is drawn from the theme tokens (ink, event, primary), sized at 1.5 cap height beside the wordmark and aligned on its baseline. Icons are a single line set (lucide) at 1.75 to 2 px stroke; beside text they size to `1cap` on the baseline, icon-only controls hold 16 px in a 28 px box.

## Components

Controls are compact and plain: a hairline box, the system face, one accent.

### Buttons
- **Shape:** 28 px high, 5 px radius, 1 px hairline border.
- **Default:** ground fill, ink text at weight 500, 12 px side padding; hover fills `chrome-hover` on pointer devices only.
- **Primary:** cobalt fill and border with `primary-ink` text; hover mixes 12% ink into the cobalt.
- **Quiet:** borderless, cobalt text, 8 px padding (Locate, Forget, Close, Import folder). A quiet button that starts a line pulls its text onto the rail's text column.
- **Icon button:** 28 px square, muted 16 px line icon, hover fills `chrome-hover` and inks the icon; pressed state inks it.
- **Toggle:** a default button that is on takes a cobalt border and text on `primary-wash` (Show chosen channels only).
- **Unavailable:** a button that cannot act now stays focusable at 45% opacity, full opacity while focused, with its reason beside it in aria-describedby (batch Start, Show chosen channels only).
- **Press:** every button and select trigger scales to `--motion-scale` (0.97) while pressed.

### Inputs / Fields
- **Style:** 28 px high (select triggers 26 px), ground fill, hairline border, 5 px radius, muted placeholder.
- **Focus:** the global 2 px `focus` outline at 1 px offset; in forced colors it becomes the system Highlight.
- **Field pattern:** a muted 12 px label set before its control on one line.

### Menus, Popovers and Tooltips
- **Menu:** ground fill, hairline border, popover shadow; the highlighted item fills cobalt with no transition, since it follows the pointer and the keys.
- **Popover:** 340 px wide, 16 px padding, a 15 px title, muted prose at 1.45 leading, a hairline above a closing storage or settings block. The Local popover opens from a muted "Local" note in the bar whose label never changes.
- **Tooltip:** ink fill, ground text, 12 px, 3 px radius.
- **Entrance:** popups grow from their trigger (`--transform-origin`) out of `--motion-scale` and fade.

### Navigation
- **Command bar:** chrome fill, hairline under it; panel toggle, the Echo mark and wordmark, the recording name after a hairline, paging, the scale settings, Annotate, Run, then the Local note and icon-only theme and About buttons at the far right.
- **Recording tabs:** 32 px strip on chrome, short hairlines between tabs; the selected tab is ground with a cobalt top edge and joins the canvas.
- **Library rail:** sections Recent, Folder (a filterable folder tree), OpenNeuro and History, each under a small-caps heading with its count at the right. The current entry is washed in `primary-wash`; metadata lines are muted 12 px fields split by a 10 px hairline.
- **Inspector:** channel groups as swatch, small-caps acronym and count, under a Show chosen channels only toggle that reduces the waveform rows to the channels chosen for analysis, in their order; DDA settings; the annotation list; a run bar that states windows, blocks and workers above the full-width primary Run DDA.

### Locator Strip (signature)
The overview draws the whole recording with events in red; an ink outline (1.5 px, 2 px radius, 5% ink wash) marks the part on screen, with an ink range tab above it ("30 to 40 s"). It follows the view instantly.

### Printed Scale Bar (signature)
A band at the waveform's lower left prints an L-shaped bar with its amplitude and time lengths, then sensitivity, timebase and view as labeled fields split by hairlines. Sensitivity steps from 1 µV/mm for scalp EEG to 10 mV/mm for intracranial contacts: 1, 2, 3, 5 and 7 µV/mm, then 1, 1.5, 2, 3, 5 and 7 in each decade. From 1 mV/mm on, the field, the bar's select and the amplitude print in mV; the field and the select keep one width at every step.

### Installed App
DDALAB installs from the browser's menu into a standalone window whose title bar takes the `chrome` gray of the system theme; its icon is the Echo mark on chrome, with a maskable version that keeps the mark inside the safe circle. The app opens offline from a service worker's cache of the whole build. A new build announces itself in the notice strip at the foot of the window (chrome fill, hairline above, centered ink text and a quiet Reload); during a run it says the update waits, and Reload then reloads when the run ends. Recordings open from Finder and Explorer through Open With (.edf, .bdf, .vhdr, .csv, .tsv and .txt). Exports open the browser's Save dialog where it has one and go to the downloads elsewhere. About carries a one-line install hint.

### Heatmap Color Bar
The result header names the variant and its window count, then a labeled color bar with its numeric limits; signed arrays use symmetric limits about zero.

## Do's and Don'ts

### Do:
- **Do** take every color from a `tokens.css` role and give a new role a `light-dark()` pair.
- **Do** time every transition on `--motion-duration` (160 ms) and `--motion-ease` (cubic-bezier(0.23, 1, 0.32, 1)); `scripts/check-motion.mjs` enforces it.
- **Do** make appearing elements rise from `--motion-rise` (4 px) and popups or presses scale from `--motion-scale` (0.97), animating only opacity, transform and colors.
- **Do** crossfade layout changes (panels opening and closing, results shown and closed, the theme switch) through a view transition.
- **Do** let reduced motion drop movement and keep fades: `--motion-scale` becomes 1 and `--motion-rise` 0 px.
- **Do** keep anything that follows the pointer, the keys or the data instant (locator, highlight, traces).
- **Do** use batlow for sequential arrays, vik for signed arrays in light and berlin in dark, always with a labeled color bar.
- **Do** separate inline metadata with space or a thin vertical hairline.
- **Do** gate hover styles behind `(hover: hover) and (pointer: fine)`.

### Don't:
- **Don't** separate inline metadata with runs of middle dots.
- **Don't** build the dark neon scientific dashboard or a card grid.
- **Don't** add a second accent hue, or use event red outside events, errors and destructive actions.
- **Don't** use group tints as fills for text, rows or panels.
- **Don't** put shadows on panels, rails or rows.
