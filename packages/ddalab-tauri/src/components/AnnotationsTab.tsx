import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { TauriService } from '@/services/tauriService';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Download, Upload, FileText, Trash2, Folder } from 'lucide-react';
import { PlotAnnotation } from '@/types/annotations';

interface AnnotationWithFile {
  annotation: PlotAnnotation;
  channel?: string;
  isGlobal: boolean;
  filePath: string;
}

interface FileAnnotationsResult {
  global_annotations: any[];
  channel_annotations: Record<string, any[]>;
}

export function AnnotationsTab() {
  const { fileManager } = useAppStore();
  const [annotationsByFile, setAnnotationsByFile] = useState<Map<string, AnnotationWithFile[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentFilePath = fileManager.selectedFile?.file_path;

  // Load annotations for all files
  useEffect(() => {
    loadAllAnnotations();
  }, []);

  const loadAllAnnotations = async () => {
    setLoading(true);
    setError(null);

    try {
      const api = await import('@tauri-apps/api/core');
      const allResults = await api.invoke<Record<string, FileAnnotationsResult>>('get_all_annotations');

      const annotationsMap = new Map<string, AnnotationWithFile[]>();

      // Transform annotations for each file
      Object.entries(allResults).forEach(([filePath, result]) => {
        const fileAnnotations: AnnotationWithFile[] = [];

        // Add global annotations
        if (result.global_annotations) {
          result.global_annotations.forEach((ann: any) => {
            fileAnnotations.push({
              annotation: {
                id: ann.id,
                position: ann.position,
                label: ann.label,
                description: ann.description,
                color: ann.color,
                createdAt: new Date().toISOString(),
              },
              isGlobal: true,
              filePath,
            });
          });
        }

        // Add channel-specific annotations
        if (result.channel_annotations) {
          Object.entries(result.channel_annotations).forEach(([channel, anns]: [string, any]) => {
            anns.forEach((ann: any) => {
              fileAnnotations.push({
                annotation: {
                  id: ann.id,
                  position: ann.position,
                  label: ann.label,
                  description: ann.description,
                  color: ann.color,
                  createdAt: new Date().toISOString(),
                },
                channel,
                isGlobal: false,
                filePath,
              });
            });
          });
        }

        // Sort by position
        fileAnnotations.sort((a, b) => a.annotation.position - b.annotation.position);
        annotationsMap.set(filePath, fileAnnotations);
      });

      setAnnotationsByFile(annotationsMap);
    } catch (err) {
      console.error('Failed to load annotations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load annotations');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (filePath: string) => {
    try {
      const exportedPath = await TauriService.exportAnnotations(filePath);
      if (exportedPath) {
        console.log('Annotations exported to:', exportedPath);
      }
    } catch (err) {
      console.error('Failed to export annotations:', err);
      setError(err instanceof Error ? err.message : 'Failed to export annotations');
    }
  };

  const handleImport = async () => {
    if (!currentFilePath) return;

    try {
      const importedCount = await TauriService.importAnnotations(currentFilePath);
      console.log(`Imported ${importedCount} annotations`);
      await loadAllAnnotations();
    } catch (err) {
      console.error('Failed to import annotations:', err);
      setError(err instanceof Error ? err.message : 'Failed to import annotations');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const api = await import('@tauri-apps/api/core');
      await api.invoke('delete_annotation', { annotationId: id });
      await loadAllAnnotations();
    } catch (err) {
      console.error('Failed to delete annotation:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete annotation');
    }
  };

  const formatPosition = (position: number) => {
    const minutes = Math.floor(position / 60);
    const seconds = (position % 60).toFixed(2);
    return `${minutes}:${seconds.padStart(5, '0')}`;
  };

  const totalAnnotations = Array.from(annotationsByFile.values()).reduce(
    (sum, annotations) => sum + annotations.length,
    0
  );

  return (
    <div className="h-full flex flex-col p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">All Annotations</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {annotationsByFile.size} {annotationsByFile.size === 1 ? 'file' : 'files'} with annotations
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleImport} variant="outline" size="sm" disabled={!currentFilePath}>
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">Loading annotations...</div>
          </div>
        ) : annotationsByFile.size === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">No annotations found</p>
              <p className="text-sm mt-2">
                Add annotations in the Data Visualization or DDA Results tabs
              </p>
            </div>
          </div>
        ) : (
          <Accordion type="multiple" className="w-full" defaultValue={currentFilePath ? [currentFilePath] : []}>
            {Array.from(annotationsByFile.entries()).map(([filePath, annotations]) => (
              <AccordionItem key={filePath} value={filePath}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2 flex-1">
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 text-left">
                      <div className="font-medium">{filePath.split('/').pop()}</div>
                      <div className="text-xs text-muted-foreground font-normal">
                        {filePath}
                      </div>
                    </div>
                    <Badge variant="secondary" className="mr-4">
                      {annotations.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-end mb-2">
                      <Button
                        onClick={() => handleExport(filePath)}
                        variant="outline"
                        size="sm"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Export ({annotations.length})
                      </Button>
                    </div>
                    {annotations.map((item) => (
                      <Card key={item.annotation.id} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold">{item.annotation.label}</h3>
                              {item.isGlobal ? (
                                <Badge variant="secondary">Global</Badge>
                              ) : (
                                <Badge variant="outline">{item.channel}</Badge>
                              )}
                              <Badge variant="outline" className="font-mono">
                                {formatPosition(item.annotation.position)}
                              </Badge>
                            </div>
                            {item.annotation.description && (
                              <p className="text-sm text-muted-foreground">
                                {item.annotation.description}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(item.annotation.id)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {item.annotation.color && (
                          <div className="mt-2 flex items-center gap-2">
                            <div
                              className="w-4 h-4 rounded border"
                              style={{ backgroundColor: item.annotation.color }}
                            />
                            <span className="text-xs text-muted-foreground font-mono">
                              {item.annotation.color}
                            </span>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      <div className="text-sm text-muted-foreground pt-4 border-t">
        <p>
          Total annotations: <strong>{totalAnnotations}</strong> across{' '}
          <strong>{annotationsByFile.size}</strong> {annotationsByFile.size === 1 ? 'file' : 'files'}
        </p>
      </div>
    </div>
  );
}
