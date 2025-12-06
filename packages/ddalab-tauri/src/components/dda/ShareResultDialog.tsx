"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Share2, Copy, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AccessPolicyType } from "@/types/sync";
import type { DDAResult } from "@/types/api";

interface ShareResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: DDAResult;
  onShare: (
    title: string,
    description: string,
    accessPolicy: AccessPolicyType,
  ) => Promise<string | null>;
  /** Pre-existing share link if result was already shared */
  existingShareLink?: string | null;
}

export function ShareResultDialog({
  open,
  onOpenChange,
  result,
  onShare,
  existingShareLink,
}: ShareResultDialogProps) {
  const [shareTitle, setShareTitle] = useState("");
  const [shareDescription, setShareDescription] = useState("");
  const [shareAccessPolicy, setShareAccessPolicy] =
    useState<AccessPolicyType>("public");
  const [isSharing, setIsSharing] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(
    existingShareLink || null,
  );
  const [linkCopied, setLinkCopied] = useState(false);

  // Reset state when dialog opens with a new result
  useEffect(() => {
    if (open) {
      setShareLink(existingShareLink || null);
      setLinkCopied(false);
      if (!existingShareLink) {
        setShareTitle("");
        setShareDescription("");
        setShareAccessPolicy("public");
      }
    }
  }, [open, existingShareLink]);

  const handleShare = async () => {
    if (!shareTitle.trim()) return;

    setIsSharing(true);
    try {
      const link = await onShare(
        shareTitle,
        shareDescription,
        shareAccessPolicy,
      );
      if (link) {
        setShareLink(link);
      }
    } finally {
      setIsSharing(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy link:", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Result
          </DialogTitle>
          <DialogDescription>
            Share this DDA analysis result with colleagues in your institution.
          </DialogDescription>
        </DialogHeader>

        {!shareLink ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="share-title">Title</Label>
              <Input
                id="share-title"
                value={shareTitle}
                onChange={(e) => setShareTitle(e.target.value)}
                placeholder="Enter a title for the shared result"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="share-description">Description (optional)</Label>
              <textarea
                id="share-description"
                value={shareDescription}
                onChange={(e) => setShareDescription(e.target.value)}
                placeholder="Add a description..."
                rows={3}
                className="flex min-h-[80px] w-full max-w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="space-y-2">
              <Label>Access Policy</Label>
              <RadioGroup
                value={shareAccessPolicy}
                onValueChange={(value) =>
                  setShareAccessPolicy(value as AccessPolicyType)
                }
                className="space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="public" id="access-public" />
                  <Label htmlFor="access-public" className="cursor-pointer">
                    Public - Anyone in your institution can access
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="team" id="access-team" />
                  <Label htmlFor="access-team" className="cursor-pointer">
                    Team - Only team members can access
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Share link created!</span>
            </div>

            <div className="space-y-2">
              <Label>Share Link</Label>
              <div className="flex gap-2 w-full">
                <Input
                  readOnly
                  value={shareLink}
                  className="font-mono text-sm flex-1 min-w-0"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyShareLink}
                  title="Copy to clipboard"
                  aria-label="Copy share link to clipboard"
                  className="shrink-0"
                >
                  {linkCopied ? (
                    <CheckCircle2
                      className="h-4 w-4 text-green-600"
                      aria-hidden="true"
                    />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link with colleagues. Results are available while
                your instance is online.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!shareLink ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleShare}
                disabled={isSharing || !shareTitle.trim()}
              >
                {isSharing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4 mr-2" />
                    Create Share Link
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
