import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

type AnnotationPreview = {
  id: string;
  position: number;
  label: string;
  description?: string;
  color?: string;
  channel?: string;
  status: 'new' | 'duplicate' | 'near_duplicate';
  similarity_score: number;
  closest_existing?: {
    label: string;
    position: number;
    time_diff: number;
  };
  source_file: string;
  source_filename: string;
};

type AvailableFile = {
  path: string;
  filename: string;
  annotation_count: number;
};

type ImportPreviewData = {
  source_file: string;
  target_file: string;
  annotations: AnnotationPreview[];
  warnings: string[];
  summary: {
    total: number;
    new: number;
    duplicates: number;
    near_duplicates: number;
  };
  is_multi_file_export: boolean;
  available_files: AvailableFile[];
  import_file_path: string;
};

interface ImportPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  previewData: ImportPreviewData | null;
  onConfirm: (importFilePath: string, targetFilePath: string, selectedIds: string[]) => Promise<void>;
}

export function ImportPreviewDialog({
  isOpen,
  onClose,
  previewData,
  onConfirm,
}: ImportPreviewDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);

  // Initially select all "new" annotations when dialog opens
  useEffect(() => {
    if (isOpen && previewData && previewData.annotations.length > 0) {
      const newIds = previewData.annotations
        .filter(ann => ann.status === 'new')
        .map(ann => ann.id);
      setSelectedIds(new Set(newIds));
    }
  }, [isOpen, previewData]);

  if (!previewData) return null;

  const toggleAnnotation = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    setSelectedIds(new Set(previewData.annotations.map(ann => ann.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const selectOnlyNew = () => {
    const newIds = previewData.annotations
      .filter(ann => ann.status === 'new')
      .map(ann => ann.id);
    setSelectedIds(new Set(newIds));
  };

  const handleConfirm = async () => {
    if (!previewData) return;

    setIsImporting(true);
    try {
      await onConfirm(previewData.import_file_path, previewData.target_file, Array.from(selectedIds));
      onClose();
    } finally {
      setIsImporting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, '0')}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'new':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'duplicate':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'near_duplicate':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return <Badge variant="default" className="bg-green-500">New</Badge>;
      case 'duplicate':
        return <Badge variant="destructive">Duplicate</Badge>;
      case 'near_duplicate':
        return <Badge variant="secondary" className="bg-yellow-500 text-black">Near Duplicate</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (!previewData) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Preview Annotation Import</DialogTitle>
          <DialogDescription>
            {previewData.is_multi_file_export
              ? `Review and select annotations from ${previewData.available_files.length} file${previewData.available_files.length !== 1 ? 's' : ''} to import`
              : `Review and select annotations to import from ${previewData.source_file.split('/').pop()}`
            }
          </DialogDescription>
        </DialogHeader>

        {/* Multi-file export info */}
        {previewData.is_multi_file_export && previewData.available_files.length > 0 && (
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                  Multi-file export detected
                </p>
                <p className="text-blue-700 dark:text-blue-300 mb-2">
                  Showing annotations from all files. Annotations will be imported into the currently selected file.
                </p>
                <details className="text-xs">
                  <summary className="cursor-pointer text-blue-600 dark:text-blue-400 hover:underline">
                    View all {previewData.available_files.length} files in export
                  </summary>
                  <ul className="mt-2 space-y-1 ml-4">
                    {previewData.available_files.map((file) => (
                      <li key={file.path} className="text-muted-foreground">
                        <span className="font-mono">{file.filename}</span>
                        <span className="ml-2 text-xs">({file.annotation_count} annotation{file.annotation_count !== 1 ? 's' : ''})</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-4 gap-4 py-4">
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <div className="flex-1">
              <div className="text-2xl font-bold">{previewData.summary.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-lg">
            <div className="flex-1">
              <div className="text-2xl font-bold text-green-600">{previewData.summary.new}</div>
              <div className="text-xs text-muted-foreground">New</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-yellow-500/10 rounded-lg">
            <div className="flex-1">
              <div className="text-2xl font-bold text-yellow-600">{previewData.summary.near_duplicates}</div>
              <div className="text-xs text-muted-foreground">Near Duplicates</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg">
            <div className="flex-1">
              <div className="text-2xl font-bold text-red-600">{previewData.summary.duplicates}</div>
              <div className="text-xs text-muted-foreground">Duplicates</div>
            </div>
          </div>
        </div>

        {/* Warnings */}
        {previewData.warnings.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4">
            <div className="font-semibold text-yellow-700 dark:text-yellow-500 mb-2">Warnings:</div>
            <ul className="text-sm space-y-1">
              {previewData.warnings.map((warning, i) => (
                <li key={i} className="text-yellow-600 dark:text-yellow-400">• {warning}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Selection Controls */}
        <div className="flex items-center gap-2 border-b pb-3">
          <span className="text-sm font-medium">Selected: {selectedIds.size} / {previewData.annotations.length}</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
          <Button variant="outline" size="sm" onClick={selectNone}>Select None</Button>
          <Button variant="outline" size="sm" onClick={selectOnlyNew}>Only New</Button>
        </div>

        {/* Annotation List */}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-left">
                <th className="w-12 p-2"></th>
                <th className="w-24 p-2">Status</th>
                {previewData.is_multi_file_export && <th className="w-48 p-2">Source File</th>}
                <th className="w-32 p-2">Time</th>
                <th className="p-2">Label</th>
                <th className="w-24 p-2">Channel</th>
                <th className="p-2">Similarity Info</th>
              </tr>
            </thead>
            <tbody>
              {previewData.annotations.map((ann) => (
                <tr
                  key={ann.id}
                  className={`border-b hover:bg-muted/50 transition-colors ${
                    selectedIds.has(ann.id) ? 'bg-primary/5' : ''
                  }`}
                >
                  <td className="p-2">
                    <Checkbox
                      checked={selectedIds.has(ann.id)}
                      onCheckedChange={() => toggleAnnotation(ann.id)}
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(ann.status)}
                      {getStatusBadge(ann.status)}
                    </div>
                  </td>
                  {previewData.is_multi_file_export && (
                    <td className="p-2">
                      <div className="text-xs font-mono text-muted-foreground" title={ann.source_file}>
                        {ann.source_filename}
                      </div>
                    </td>
                  )}
                  <td className="p-2 font-mono text-sm">{formatTime(ann.position)}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {ann.color && (
                        <div
                          className="w-3 h-3 rounded-full border"
                          style={{ backgroundColor: ann.color }}
                        />
                      )}
                      <span className="font-medium">{ann.label}</span>
                    </div>
                    {ann.description && (
                      <div className="text-xs text-muted-foreground mt-1">{ann.description}</div>
                    )}
                  </td>
                  <td className="p-2 text-sm">
                    {ann.channel ? <Badge variant="outline">{ann.channel}</Badge> : <Badge variant="secondary">Global</Badge>}
                  </td>
                  <td className="p-2 text-sm">
                    {ann.closest_existing && (
                      <div className="text-xs">
                        <div>Closest: "{ann.closest_existing.label}" at {formatTime(ann.closest_existing.position)}</div>
                        <div className="text-muted-foreground">
                          Δ: {ann.closest_existing.time_diff > 0 ? '+' : ''}{ann.closest_existing.time_diff.toFixed(2)}s
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0 || isImporting}
          >
            {isImporting ? 'Importing...' : `Import ${selectedIds.size} Annotation${selectedIds.size !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
