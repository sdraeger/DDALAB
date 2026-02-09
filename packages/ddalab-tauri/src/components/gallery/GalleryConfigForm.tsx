"use client";

import { useAppStore } from "@/store/appStore";
import { tauriBackendService } from "@/services/tauriBackendService";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Folder } from "lucide-react";

export function GalleryConfigForm() {
  const config = useAppStore((s) => s.gallery.config);
  const setGalleryConfig = useAppStore((s) => s.setGalleryConfig);

  const handlePickDirectory = async () => {
    const dir = await tauriBackendService.selectGalleryDirectory();
    if (dir) {
      setGalleryConfig({ outputDirectory: dir });
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="gallery-output-dir">Output Directory</Label>
        <div className="flex gap-2">
          <Input
            id="gallery-output-dir"
            value={config.outputDirectory}
            onChange={(e) =>
              setGalleryConfig({ outputDirectory: e.target.value })
            }
            placeholder="Select output directory..."
            className="flex-1"
            readOnly
          />
          <Button variant="outline" size="icon" onClick={handlePickDirectory}>
            <Folder className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="gallery-title">Site Title</Label>
        <Input
          id="gallery-title"
          value={config.siteTitle}
          onChange={(e) => setGalleryConfig({ siteTitle: e.target.value })}
          placeholder="DDA Results Gallery"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="gallery-description">Site Description</Label>
        <Input
          id="gallery-description"
          value={config.siteDescription}
          onChange={(e) =>
            setGalleryConfig({ siteDescription: e.target.value })
          }
          placeholder="Delay Differential Analysis results"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="gallery-author">Author</Label>
        <Input
          id="gallery-author"
          value={config.author}
          onChange={(e) => setGalleryConfig({ author: e.target.value })}
          placeholder="Your name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="gallery-theme">Theme</Label>
        <Select
          value={config.theme}
          onValueChange={(val) =>
            setGalleryConfig({ theme: val as "light" | "dark" })
          }
        >
          <SelectTrigger id="gallery-theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
