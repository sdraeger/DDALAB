// Electrode groups from channel labels: the leading letters name the group (ATT1 is ATT, G12 is G). Each group keeps
// one tint everywhere it appears, in order of first appearance; labels without leading letters form "Other".

/** Tints in tokens.css; groups past the last one reuse the family in order. */
const TINTS = 8;

export interface Group {
  name: string;
  /** Display channel indices, ascending. */
  members: number[];
  /** CSS color of the group's marks. */
  tint: string;
}

/** A channel's label as shown: an empty one as its 1-based position among the display channels (a request's
 * channel indices count the same way), "Ch 6". */
export const shownLabel = (label: string, index: number) => (label.trim() ? label : `Ch ${index + 1}`);

export function electrodeGroups(labels: string[]): { groups: Group[]; groupOf: Int32Array } {
  const groups: Group[] = [];
  const byName = new Map<string, Group>();
  const groupOf = new Int32Array(labels.length);
  labels.forEach((label, channel) => {
    const name = /^\p{L}+/u.exec(label.trim())?.[0] ?? "Other";
    let group = byName.get(name);
    if (!group) {
      group = { name, members: [], tint: `var(--group-${(groups.length % TINTS) + 1})` };
      byName.set(name, group);
      groups.push(group);
    }
    groupOf[channel] = groups.indexOf(group);
    group.members.push(channel);
  });
  return { groups, groupOf };
}

/** The shown labels of the `analysis` channels of `channels` and their electrode groups, which come from the labels
 * as recorded: an unnamed channel joins "Other". */
export function channelLabels(channels: { label: string }[], analysis: number[]) {
  const recorded = analysis.map((i) => channels[i].label);
  return { labels: recorded.map(shownLabel), ...electrodeGroups(recorded) };
}
