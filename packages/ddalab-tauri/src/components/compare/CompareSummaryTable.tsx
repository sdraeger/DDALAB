"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COMPARE_COLORS } from "./CompareEntryList";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";
import type { AnalysisMetadataBatchItem } from "@/services/tauriBackendService";

interface CompareSummaryTableProps {
  entries: ComparisonEntry[];
  metadata: AnalysisMetadataBatchItem[];
}

type SortField = "label" | "channels" | "variants" | "date";
type SortDir = "asc" | "desc";

export function CompareSummaryTable({
  entries,
  metadata,
}: CompareSummaryTableProps) {
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const metadataMap = useMemo(() => {
    const map = new Map<string, AnalysisMetadataBatchItem>();
    for (const m of metadata) {
      map.set(m.id, m);
    }
    return map;
  }, [metadata]);

  const sorted = useMemo(() => {
    const items = entries.map((entry, i) => ({
      entry,
      index: i,
      meta: metadataMap.get(entry.analysisId),
    }));

    items.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "label":
          cmp = a.entry.label.localeCompare(b.entry.label);
          break;
        case "channels":
          cmp = a.entry.channels.length - b.entry.channels.length;
          break;
        case "variants":
          cmp = a.entry.variantIds.length - b.entry.variantIds.length;
          break;
        case "date":
          cmp = a.entry.createdAt.localeCompare(b.entry.createdAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [entries, sortField, sortDir, metadataMap]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortButton = ({
    field,
    children,
  }: {
    field: SortField;
    children: React.ReactNode;
  }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 -ml-2 text-xs font-medium"
      onClick={() => toggleSort(field)}
    >
      {children}
      <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground" />
    </Button>
  );

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8" />
            <TableHead>
              <SortButton field="label">File</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="variants">Variant</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="channels">Channels</SortButton>
            </TableHead>
            <TableHead>Parameters</TableHead>
            <TableHead>
              <SortButton field="date">Date</SortButton>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(({ entry, index, meta }) => (
            <TableRow key={entry.analysisId}>
              <TableCell>
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    backgroundColor:
                      COMPARE_COLORS[index % COMPARE_COLORS.length],
                  }}
                />
              </TableCell>
              <TableCell className="font-medium text-xs">
                <div className="max-w-48 truncate" title={entry.filePath}>
                  {entry.label}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {entry.variantIds.map((v) => (
                    <Badge
                      key={v}
                      variant="secondary"
                      className="text-[10px] py-0"
                    >
                      {meta?.variantDisplayName ?? v}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {entry.channels.length}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {meta?.parameters ? formatParams(meta.parameters) : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(entry.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatParams(params: Record<string, unknown>): string {
  const parts: string[] = [];
  if (params.window_length) parts.push(`w=${params.window_length}`);
  if (params.window_step) parts.push(`s=${params.window_step}`);
  if (Array.isArray(params.delay_list))
    parts.push(`d=${params.delay_list.length} delays`);
  return parts.join(", ") || "—";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
