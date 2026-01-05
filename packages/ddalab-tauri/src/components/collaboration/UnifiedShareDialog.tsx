/**
 * UnifiedShareDialog - Share any content type through the collaboration system
 */
import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, Check, Share2, Building2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { useClipboard } from "@/hooks/useClipboard";
import {
  useShareContent,
  createDefaultAccessPolicy,
} from "@/hooks/useShareContent";
import {
  useHipaaMode,
  useInstitutionConfig,
} from "@/hooks/useInstitutionConfig";
import { useFederatedInstitutions } from "@/hooks/useFederation";
import type {
  ShareableContentType,
  AccessPolicyType,
  DataClassification,
} from "@/types/sync";
import { SHAREABLE_CONTENT_LABELS, DEFAULT_EXPIRY_DAYS } from "@/types/sync";

interface UnifiedShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: ShareableContentType;
  contentId: string;
  contentData?: unknown;
  defaultTitle?: string;
  defaultDescription?: string;
  institutionId?: string;
}

export function UnifiedShareDialog({
  open,
  onOpenChange,
  contentType,
  contentId,
  contentData,
  defaultTitle = "",
  defaultDescription = "",
  institutionId = "default",
}: UnifiedShareDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [accessPolicyType, setAccessPolicyType] =
    useState<AccessPolicyType>("public");
  const [classification, setClassification] =
    useState<DataClassification>("unclassified");
  const [includeFederated, setIncludeFederated] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);

  // Use clipboard hook for proper cleanup
  const {
    copied,
    copy,
    reset: resetClipboard,
  } = useClipboard({
    onError: (err) => toast.error("Copy failed", err.message),
  });

  const { mutateAsync: shareContent, isPending } = useShareContent();
  const isHipaaMode = useHipaaMode();
  const { config: institutionConfig } = useInstitutionConfig();
  const { data: federatedInstitutions } =
    useFederatedInstitutions(institutionId);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setDescription(defaultDescription);
      setAccessPolicyType("public");
      setClassification("unclassified");
      setIncludeFederated(false);
      setShareLink(null);
      resetClipboard();
    }
  }, [open, defaultTitle, defaultDescription, resetClipboard]);

  const canFederate =
    institutionConfig?.allow_federation &&
    (federatedInstitutions?.length ?? 0) > 0 &&
    classification !== "phi"; // PHI cannot be federated

  const handleShare = useCallback(async () => {
    try {
      const accessPolicy = createDefaultAccessPolicy(
        institutionId,
        classification,
      );
      accessPolicy.type = accessPolicyType;

      // Include federated institutions if selected and allowed
      if (includeFederated && canFederate && federatedInstitutions) {
        accessPolicy.federated_institution_ids = federatedInstitutions.map(
          (inst) => inst.institution_id,
        );
      }

      const link = await shareContent({
        contentType,
        contentId,
        title: title || `Shared ${SHAREABLE_CONTENT_LABELS[contentType]}`,
        description: description || undefined,
        accessPolicy,
        classification,
        contentData,
      });
      setShareLink(link);
      toast.success("Share created", "Your share link is ready");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create share";
      toast.error("Share failed", message);
    }
  }, [
    shareContent,
    contentType,
    contentId,
    title,
    description,
    accessPolicyType,
    classification,
    contentData,
    institutionId,
    includeFederated,
    canFederate,
    federatedInstitutions,
  ]);

  const handleCopy = useCallback(async () => {
    if (shareLink) {
      await copy(shareLink);
    }
  }, [shareLink, copy]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const contentLabel = SHAREABLE_CONTENT_LABELS[contentType];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" aria-hidden="true" />
            Share {contentLabel}
          </DialogTitle>
          <DialogDescription>
            Create a shareable link for this {contentLabel.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        {!shareLink ? (
          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="share-title">Title</Label>
              <Input
                id="share-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`My ${contentLabel}`}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="share-description">Description (optional)</Label>
              <Textarea
                id="share-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                rows={3}
              />
            </div>

            {/* Data Classification (only in HIPAA mode) */}
            {isHipaaMode && (
              <div className="space-y-2">
                <Label>Data Classification</Label>
                <RadioGroup
                  value={classification}
                  onValueChange={(v) =>
                    setClassification(v as DataClassification)
                  }
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="phi" id="classification-phi" />
                    <Label htmlFor="classification-phi" className="font-normal">
                      PHI (Institution only, 7-day expiry)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="de_identified"
                      id="classification-deidentified"
                    />
                    <Label
                      htmlFor="classification-deidentified"
                      className="font-normal"
                    >
                      De-identified (30-day expiry)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="synthetic"
                      id="classification-synthetic"
                    />
                    <Label
                      htmlFor="classification-synthetic"
                      className="font-normal"
                    >
                      Synthetic / Test data (90-day expiry)
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Access Policy */}
            <div className="space-y-2">
              <Label>Share With</Label>
              <RadioGroup
                value={accessPolicyType}
                onValueChange={(v) =>
                  setAccessPolicyType(v as AccessPolicyType)
                }
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="public" id="policy-public" />
                  <Label htmlFor="policy-public" className="font-normal">
                    Anyone in institution
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="institution" id="policy-institution" />
                  <Label htmlFor="policy-institution" className="font-normal">
                    All institution members
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Federation Option */}
            {canFederate && (
              <div className="space-y-2 p-3 rounded-lg border bg-muted/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" aria-hidden="true" />
                    <Label htmlFor="include-federated" className="font-medium">
                      Include federated institutions
                    </Label>
                  </div>
                  <Checkbox
                    id="include-federated"
                    checked={includeFederated}
                    onCheckedChange={(checked) =>
                      setIncludeFederated(checked === true)
                    }
                  />
                </div>
                {includeFederated && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {federatedInstitutions?.map((inst) => (
                      <Badge key={inst.institution_id} variant="secondary">
                        {inst.institution_name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* PHI Federation Warning */}
            {classification === "phi" &&
              institutionConfig?.allow_federation && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
                  <AlertTriangle
                    className="h-4 w-4 text-amber-600 mt-0.5"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    PHI content cannot be shared with federated institutions for
                    HIPAA compliance.
                  </p>
                </div>
              )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleShare} disabled={isPending}>
                {isPending ? "Creating..." : "Create Share Link"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Share Link</Label>
              <div className="flex gap-2">
                <Input
                  value={shareLink}
                  readOnly
                  className="flex-1"
                  aria-label="Share link"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  aria-label={
                    copied ? "Copied to clipboard" : "Copy link to clipboard"
                  }
                >
                  {copied ? (
                    <Check
                      className="h-4 w-4 text-green-500"
                      aria-hidden="true"
                    />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Share this link with colleagues. Expires in{" "}
                {DEFAULT_EXPIRY_DAYS[classification]} days.
              </p>
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
