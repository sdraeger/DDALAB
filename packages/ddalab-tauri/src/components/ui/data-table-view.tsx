"use client";

import React, { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "@/components/ui/toaster";

export interface DataTableColumn {
  header: string;
  accessor: string;
  formatter?: (value: any) => string;
}

export interface DataTableViewProps {
  data: any[];
  columns: DataTableColumn[];
  title?: string;
  description?: string;
  maxRows?: number;
  enableExport?: boolean;
  exportFilename?: string;
  className?: string;
}

export const DataTableView: React.FC<DataTableViewProps> = ({
  data,
  columns,
  title,
  description,
  maxRows = 1000,
  enableExport = true,
  exportFilename = "data-export.csv",
  className = "",
}) => {
  const displayData = useMemo(() => {
    return data.slice(0, maxRows);
  }, [data, maxRows]);

  const handleExportCSV = () => {
    try {
      const headers = columns.map((col) => col.header).join(",");
      const rows = data.map((row) =>
        columns
          .map((col) => {
            const value = row[col.accessor];
            const formatted = col.formatter
              ? col.formatter(value)
              : String(value ?? "");
            return `"${formatted.replace(/"/g, '""')}"`;
          })
          .join(","),
      );

      const csv = [headers, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);

      link.setAttribute("href", url);
      link.setAttribute("download", exportFilename);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success("Export Complete", `Downloaded ${exportFilename}`);
    } catch (error) {
      toast.error("Export Failed", "Could not export data to CSV");
    }
  };

  const isTruncated = data.length > maxRows;

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          {title && <h3 className="text-lg font-semibold">{title}</h3>}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Showing {displayData.length.toLocaleString()} of{" "}
            {data.length.toLocaleString()} rows
            {isTruncated && " (truncated for display)"}
          </p>
        </div>

        {enableExport && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                {columns.map((column, idx) => (
                  <TableHead key={idx} className="font-semibold">
                    {column.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayData.map((row, rowIdx) => (
                <TableRow key={rowIdx}>
                  {columns.map((column, colIdx) => {
                    const value = row[column.accessor];
                    const formatted = column.formatter
                      ? column.formatter(value)
                      : String(value ?? "-");

                    return (
                      <TableCell key={colIdx} className="font-mono text-sm">
                        {formatted}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {isTruncated && (
        <p className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
          <strong>Note:</strong> Display limited to {maxRows.toLocaleString()}{" "}
          rows. Export to CSV to access all {data.length.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
};
