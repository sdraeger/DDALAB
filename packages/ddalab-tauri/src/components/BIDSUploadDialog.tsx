'use client';

import { useState, useEffect } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react';
import { openNeuroService, type UploadOptions, type UploadProgress } from '@/services/openNeuroService';
import { listen } from '@tauri-apps/api/event';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface BIDSUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  datasetPath: string;
  onUploadComplete?: (datasetId: string) => void;
}

export function BIDSUploadDialog({
  isOpen,
  onClose,
  datasetPath,
  onUploadComplete,
}: BIDSUploadDialogProps) {
  const [datasetName, setDatasetName] = useState('');
  const [datasetDescription, setDatasetDescription] = useState('');
  const [affirmDefaced, setAffirmDefaced] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    if (isOpen) {
      listen<UploadProgress>('openneuro-upload-progress', (event) => {
        setUploadProgress(event.payload);

        if (event.payload.phase === 'completed' && event.payload.dataset_id) {
          setDatasetId(event.payload.dataset_id);
          setUploading(false);
        } else if (event.payload.phase === 'error') {
          setError(event.payload.message);
          setUploading(false);
        }
      }).then((unlistenFn) => {
        unlisten = unlistenFn;
      });
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isOpen]);

  const handleUpload = async () => {
    if (!affirmDefaced) {
      setError('You must confirm that structural scans have been defaced or you have consent');
      return;
    }

    if (!datasetName.trim()) {
      setError('Dataset name is required');
      return;
    }

    setError(null);
    setUploading(true);
    setUploadProgress(null);

    try {
      // Check authentication
      if (!openNeuroService.isAuthenticated()) {
        throw new Error('Please configure your OpenNeuro API key first');
      }

      // Step 1: Create dataset on OpenNeuro
      setUploadProgress({
        dataset_id: undefined,
        phase: 'creating_dataset',
        progress_percent: 10,
        message: 'Creating dataset on OpenNeuro...',
        current_file: undefined,
        files_uploaded: undefined,
        total_files: undefined,
      });

      const createdDatasetId = await openNeuroService.createDataset(
        datasetName.trim(),
        affirmDefaced,
        affirmDefaced
      );

      setDatasetId(createdDatasetId);

      setUploadProgress({
        dataset_id: createdDatasetId,
        phase: 'uploading_files',
        progress_percent: 30,
        message: 'Dataset created. Preparing file upload...',
        current_file: undefined,
        files_uploaded: undefined,
        total_files: undefined,
      });

      // Step 2: Initiate upload via Tauri backend
      const options: UploadOptions = {
        dataset_path: datasetPath,
        affirm_defaced: affirmDefaced,
        dataset_name: datasetName.trim(),
        dataset_description: datasetDescription.trim() || undefined,
      };

      await openNeuroService.uploadDataset(options);

      // The upload will continue in the background, progress tracked via events
      // For now, we show success after validation
      setUploadProgress({
        dataset_id: createdDatasetId,
        phase: 'completed',
        progress_percent: 100,
        message: `Dataset created successfully! Visit https://openneuro.org/datasets/${createdDatasetId}`,
        current_file: undefined,
        files_uploaded: undefined,
        total_files: undefined,
      });

      setUploading(false);

      if (onUploadComplete) {
        onUploadComplete(createdDatasetId);
      }

    } catch (err) {
      console.error('Upload failed:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setDatasetName('');
      setDatasetDescription('');
      setAffirmDefaced(false);
      setError(null);
      setUploadProgress(null);
      setDatasetId(null);
      onClose();
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleClose}>
      <AlertDialogContent className="sm:max-w-[600px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Upload BIDS Dataset to OpenNeuro</AlertDialogTitle>
          <AlertDialogDescription>
            Share your BIDS dataset with the neuroscience community
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          {/* Dataset Path */}
          <div className="space-y-2">
            <Label>Dataset Path</Label>
            <Input value={datasetPath} disabled />
          </div>

          {/* Dataset Name */}
          <div className="space-y-2">
            <Label htmlFor="dataset-name">Dataset Name *</Label>
            <Input
              id="dataset-name"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="My BIDS Dataset"
              disabled={uploading}
            />
          </div>

          {/* Dataset Description */}
          <div className="space-y-2">
            <Label htmlFor="dataset-description">Description (optional)</Label>
            <textarea
              id="dataset-description"
              value={datasetDescription}
              onChange={(e) => setDatasetDescription(e.target.value)}
              placeholder="Describe your dataset..."
              rows={3}
              disabled={uploading}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Deface Confirmation */}
          <div className="flex items-start space-x-3 p-4 bg-yellow-50 dark:bg-yellow-950 rounded-md">
            <Checkbox
              id="affirm-defaced"
              checked={affirmDefaced}
              onCheckedChange={(checked) => setAffirmDefaced(checked as boolean)}
              disabled={uploading}
            />
            <div className="grid gap-1.5 leading-none">
              <label
                htmlFor="affirm-defaced"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                I confirm that structural scans have been defaced *
              </label>
              <p className="text-sm text-muted-foreground">
                Or I have explicit participant consent and ethical authorization to publish
                identifiable data
              </p>
            </div>
          </div>

          {/* Upload Progress */}
          {uploadProgress && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                {uploadProgress.phase === 'completed' ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : uploadProgress.phase === 'error' ? (
                  <AlertCircle className="h-4 w-4 text-red-600" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                )}
                <span className="text-sm font-medium">{uploadProgress.message}</span>
              </div>
              <Progress value={uploadProgress.progress_percent} />
              {uploadProgress.current_file && (
                <p className="text-sm text-muted-foreground">
                  Uploading: {uploadProgress.current_file}
                </p>
              )}
              {uploadProgress.files_uploaded !== undefined && uploadProgress.total_files !== undefined && (
                <p className="text-sm text-muted-foreground">
                  {uploadProgress.files_uploaded} / {uploadProgress.total_files} files uploaded
                </p>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success Message with Link */}
          {datasetId && uploadProgress?.phase === 'completed' && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Dataset uploaded successfully!{' '}
                <a
                  href={`https://openneuro.org/datasets/${datasetId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-primary"
                >
                  View on OpenNeuro
                </a>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose} disabled={uploading}>
            {datasetId ? 'Close' : 'Cancel'}
          </AlertDialogCancel>
          {!datasetId && (
            <AlertDialogAction onClick={handleUpload} disabled={uploading || !affirmDefaced || !datasetName.trim()}>
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload to OpenNeuro
                </>
              )}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
