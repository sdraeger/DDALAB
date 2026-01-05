/**
 * MyShares - Display content the current user has shared
 */
import { useState, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Link2,
  Trash2,
  Clock,
  Search,
  Users,
  Eye,
  Loader2,
  AlertTriangle,
  Check,
} from "lucide-react";
import { useMyShares } from "@/hooks/useSharedContent";
import { SHAREABLE_CONTENT_LABELS } from "@/types/sync";
import type { ShareMetadata } from "@/types/sync";
import { format } from "date-fns";
import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toaster";
import { useClipboard } from "@/hooks/useClipboard";
import { CONTENT_TYPE_ICONS } from "./constants";

export function MyShares() {
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();

  const { data: shares, isLoading, error } = useMyShares();

  // Use custom clipboard hook with proper cleanup and error handling
  const { copied, copiedValue, copy } = useClipboard({
    onSuccess: () =>
      toast.success("Link copied", "Share link copied to clipboard"),
    onError: (err) => toast.error("Copy failed", err.message),
  });

  // Mutation for revoking shares with proper error handling
  const { mutateAsync: revokeShare, isPending: isRevoking } = useMutation({
    mutationFn: async (token: string) => {
      await invoke("sync_revoke_share", { token });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shares"] });
      toast.success("Share revoked", "The share link is no longer valid");
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to revoke share";
      toast.error("Revoke failed", message);
    },
  });

  // Memoize filtered shares
  const filteredShares = useMemo(() => {
    if (!shares) return [];

    const query = searchQuery.toLowerCase();

    return shares.filter((share) => {
      return (
        query === "" ||
        share.title?.toLowerCase().includes(query) ||
        share.description?.toLowerCase().includes(query)
      );
    });
  }, [shares, searchQuery]);

  // Handle copy with proper link format
  const handleCopyLink = useCallback(
    async (contentId: string) => {
      const link = `ddalab://share/${contentId}`;
      await copy(link);
    },
    [copy],
  );

  // Handle revoke with error handling
  const handleRevoke = useCallback(
    async (contentId: string) => {
      try {
        await revokeShare(contentId);
      } catch {
        // Error is handled by mutation's onError
      }
    },
    [revokeShare],
  );

  // Memoized render function
  const renderShareItem = useCallback(
    (share: ShareMetadata) => {
      const Icon = CONTENT_TYPE_ICONS[share.content_type];
      const expiresAt = share.access_policy?.expires_at
        ? new Date(share.access_policy.expires_at)
        : new Date();
      const isCopied =
        copied && copiedValue === `ddalab://share/${share.content_id}`;

      return (
        <Card key={share.content_id} className="mb-2">
          <CardHeader className="py-3">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-muted rounded-md">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-sm font-medium">
                    {share.title}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {SHAREABLE_CONTENT_LABELS[share.content_type]}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {share.access_policy?.type === "public"
                    ? "Anyone"
                    : share.access_policy?.type === "team"
                      ? "Team"
                      : share.access_policy?.type === "users"
                        ? "Specific users"
                        : "Institution"}
                </Badge>
                {share.classification &&
                  share.classification !== "unclassified" && (
                    <Badge
                      variant={
                        share.classification === "phi"
                          ? "destructive"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      {share.classification.toUpperCase()}
                    </Badge>
                  )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>Expires {format(expiresAt, "MMM d, yyyy")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  <span>
                    {share.download_count ?? 0} view
                    {(share.download_count ?? 0) !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyLink(share.content_id)}
                  aria-label={`Copy link for ${share.title}`}
                >
                  {isCopied ? (
                    <>
                      <Check
                        className="h-4 w-4 mr-1 text-green-500"
                        aria-hidden="true"
                      />
                      Copied
                    </>
                  ) : (
                    <>
                      <Link2 className="h-4 w-4 mr-1" aria-hidden="true" />
                      Copy Link
                    </>
                  )}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke share for ${share.title}`}
                      disabled={isRevoking}
                    >
                      <Trash2
                        className="h-4 w-4 text-destructive"
                        aria-hidden="true"
                      />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke Share</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to revoke this share? Anyone with
                        the link will no longer be able to access this content.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleRevoke(share.content_id)}
                      >
                        Revoke
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    },
    [copied, copiedValue, handleCopyLink, handleRevoke, isRevoking],
  );

  // Loading state
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center p-8"
        role="status"
        aria-label="Loading your shares"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <span className="sr-only">Loading your shares...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertTriangle
            className="h-12 w-12 text-destructive mb-4"
            aria-hidden="true"
          />
          <p className="text-destructive">Failed to load your shares.</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Please try again later."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasResults = filteredShares.length > 0;
  const hasSearchFilter = searchQuery !== "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My Shares</h2>
        <Badge variant="secondary">
          {shares?.length || 0} active share
          {(shares?.length ?? 0) !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="relative">
        <Search
          className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          placeholder="Search your shares..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8"
          aria-label="Search your shares"
        />
      </div>

      {!hasResults && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Users
              className="h-12 w-12 text-muted-foreground mb-4"
              aria-hidden="true"
            />
            {hasSearchFilter ? (
              <>
                <p className="text-muted-foreground">
                  No shares match your search.
                </p>
                <p className="text-sm text-muted-foreground">
                  Try adjusting your search query.
                </p>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  You haven&apos;t shared anything yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  Share DDA results, annotations, or workflows with your team.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {hasResults && (
        <div className="space-y-2">{filteredShares.map(renderShareItem)}</div>
      )}
    </div>
  );
}
