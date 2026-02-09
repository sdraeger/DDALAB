"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FolderOpen, Trash2 } from "lucide-react";
import type { GalleryItemResponse } from "@/hooks/useGallery";

interface GalleryItemCardProps {
  item: GalleryItemResponse;
  onOpenDirectory: (directory: string) => void;
  onRemove: (id: string) => void;
}

export function GalleryItemCard({
  item,
  onOpenDirectory,
  onRemove,
}: GalleryItemCardProps) {
  const publishedDate = new Date(item.publishedAt).toLocaleDateString();

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="font-medium text-sm truncate">{item.title}</h4>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {item.description}
              </p>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Published {publishedDate}
              {item.author && ` by ${item.author}`}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onOpenDirectory(item.outputDirectory)}
              title="Open output folder"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onRemove(item.id)}
              title="Remove from gallery"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
