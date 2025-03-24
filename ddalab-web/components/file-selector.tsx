"use client";

import type React from "react";

import { forwardRef, useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileSelectorProps {
  onFilesSelected: (files: FileList | null) => void;
  isLoading?: boolean;
  accept?: string;
}

export const FileSelector = forwardRef<HTMLInputElement, FileSelectorProps>(
  ({ onFilesSelected, isLoading = false, accept = "" }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onFilesSelected(e.target.files);
    };

    const handleButtonClick = () => {
      if (ref) {
        if (typeof ref === "function") {
          const input = inputRef.current;
          if (input) ref(input);
          input?.click();
        } else {
          ref.current?.click();
        }
      } else {
        inputRef.current?.click();
      }
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };

    const handleDragLeave = () => {
      setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      onFilesSelected(e.dataTransfer.files);
    };

    return (
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/20"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          className="hidden"
          onChange={handleFileInputChange}
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              ref.current = node;
            }
          }}
          accept={accept}
        />

        <div className="flex flex-col items-center justify-center gap-4">
          <div className="rounded-full bg-muted p-3">
            <FileUp className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium mb-1">
              Drag and drop your EDF file here, or click to browse
            </p>
            <p className="text-sm text-muted-foreground">
              Supports .edf files containing EEG data
            </p>
          </div>
          <Button
            onClick={handleButtonClick}
            disabled={isLoading}
            className="mt-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              "Select EDF File"
            )}
          </Button>
        </div>
      </div>
    );
  }
);

FileSelector.displayName = "FileSelector";
