"use client";

import React, { useState, useEffect } from "react";
import { Input } from "./input";
import { Button } from "./button";
import { Label } from "./label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { ChevronDown, Hash } from "lucide-react";
import { cn } from "../../lib/utils/misc";

interface ChunkSelectorProps {
  currentChunk: number;
  totalChunks: number;
  onChunkSelect: (chunkNumber: number) => void;
  className?: string;
  variant?: "compact" | "full";
}

export function ChunkSelector({
  currentChunk,
  totalChunks,
  onChunkSelect,
  className,
  variant = "compact",
}: ChunkSelectorProps) {
  const [inputValue, setInputValue] = useState(currentChunk.toString());
  const [isValid, setIsValid] = useState(true);

  // Update input when currentChunk changes externally
  useEffect(() => {
    setInputValue(currentChunk.toString());
    setIsValid(true);
  }, [currentChunk]);

  const validateChunk = (value: string): boolean => {
    const num = parseInt(value, 10);
    return !isNaN(num) && num >= 1 && num <= totalChunks;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setIsValid(validateChunk(value));
  };

  const handleInputSubmit = () => {
    const chunkNumber = parseInt(inputValue, 10);
    if (validateChunk(inputValue) && chunkNumber !== currentChunk) {
      onChunkSelect(chunkNumber);
    } else {
      // Reset to current chunk if invalid
      setInputValue(currentChunk.toString());
      setIsValid(true);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleInputSubmit();
    } else if (e.key === "Escape") {
      setInputValue(currentChunk.toString());
      setIsValid(true);
    }
  };

  const handleSelectChange = (value: string) => {
    const chunkNumber = parseInt(value, 10);
    if (!isNaN(chunkNumber)) {
      onChunkSelect(chunkNumber);
    }
  };

  // Generate quick jump options (first, last, quarters)
  const quickJumpOptions = [
    { label: "First", value: 1 },
    { label: "25%", value: Math.ceil(totalChunks * 0.25) },
    { label: "50%", value: Math.ceil(totalChunks * 0.5) },
    { label: "75%", value: Math.ceil(totalChunks * 0.75) },
    { label: "Last", value: totalChunks },
  ].filter((option, index, array) => {
    // Remove duplicates and ensure each value is unique
    return array.findIndex((item) => item.value === option.value) === index;
  });

  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="flex items-center gap-1">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputSubmit}
            onKeyDown={handleKeyPress}
            className={cn(
              "w-16 h-8 text-center text-sm",
              !isValid && "border-destructive focus-visible:ring-destructive"
            )}
            placeholder="1"
          />
        </div>
        <span className="text-sm text-muted-foreground">/ {totalChunks}</span>

        {totalChunks > 10 && (
          <Select onValueChange={handleSelectChange} value="">
            <SelectTrigger className="w-20 h-8">
              <ChevronDown className="h-4 w-4" />
            </SelectTrigger>
            <SelectContent>
              {quickJumpOptions.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <Label htmlFor="chunk-input" className="text-sm font-medium">
          Jump to Chunk
        </Label>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex items-center gap-1 flex-1">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <Input
              id="chunk-input"
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputSubmit}
              onKeyDown={handleKeyPress}
              className={cn(
                "text-center",
                !isValid && "border-destructive focus-visible:ring-destructive"
              )}
              placeholder="Enter chunk number"
            />
          </div>
          <Button
            onClick={handleInputSubmit}
            disabled={!isValid || parseInt(inputValue, 10) === currentChunk}
            size="sm"
          >
            Go
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
          <span>Current: {currentChunk}</span>
          <span>Total: {totalChunks}</span>
        </div>
        {!isValid && (
          <p className="text-xs text-destructive mt-1">
            Please enter a number between 1 and {totalChunks}
          </p>
        )}
      </div>

      {totalChunks > 5 && (
        <div>
          <Label className="text-sm font-medium">Quick Jump</Label>
          <div className="grid grid-cols-5 gap-1 mt-1">
            {quickJumpOptions.map((option) => (
              <Button
                key={option.value}
                variant={currentChunk === option.value ? "default" : "outline"}
                size="sm"
                onClick={() => onChunkSelect(option.value)}
                className="text-xs"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
