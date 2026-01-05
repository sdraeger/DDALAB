/**
 * SharedWithMe - Display content shared with the current user
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  Eye,
  Clock,
  Search,
  AlertTriangle,
  Loader2,
  FileBarChart,
} from "lucide-react";
import { useSharedWithMe } from "@/hooks/useSharedContent";
import { SHAREABLE_CONTENT_LABELS } from "@/types/sync";
import type { ShareableContentType, ShareMetadata } from "@/types/sync";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { CONTENT_TYPE_ICONS } from "./constants";

/** Extended share metadata with owner information */
interface SharedItem extends ShareMetadata {
  owner_name?: string;
}

interface SharedWithMeProps {
  onViewShare?: (share: ShareMetadata) => void;
  onDownloadShare?: (share: ShareMetadata) => void;
}

/** Grouped shares by time period */
interface GroupedShares {
  today: SharedItem[];
  thisWeek: SharedItem[];
  older: SharedItem[];
}

/** Options for date formatting - extracted to avoid recreation */
const DATE_FORMAT_OPTIONS = { addSuffix: true } as const;

export function SharedWithMe({
  onViewShare,
  onDownloadShare,
}: SharedWithMeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ShareableContentType | "all">(
    "all",
  );

  const { data: shares, isLoading, error } = useSharedWithMe();

  // Memoize filtered shares to prevent recalculation on every render
  const filteredShares = useMemo(() => {
    if (!shares) return [];

    const query = searchQuery.toLowerCase();

    return shares.filter((share) => {
      // Match search query against title and description
      const matchesSearch =
        query === "" ||
        share.title?.toLowerCase().includes(query) ||
        share.description?.toLowerCase().includes(query);

      // Match content type filter
      const matchesType =
        typeFilter === "all" || share.content_type === typeFilter;

      return matchesSearch && matchesType;
    });
  }, [shares, searchQuery, typeFilter]);

  // Memoize grouped shares to prevent recalculation on every render
  const groupedShares = useMemo((): GroupedShares => {
    const today = new Date();

    return {
      today: filteredShares.filter(
        (s) => differenceInDays(today, new Date(s.created_at)) === 0,
      ),
      thisWeek: filteredShares.filter((s) => {
        const days = differenceInDays(today, new Date(s.created_at));
        return days > 0 && days <= 7;
      }),
      older: filteredShares.filter(
        (s) => differenceInDays(today, new Date(s.created_at)) > 7,
      ),
    };
  }, [filteredShares]);

  // Memoize the render function to prevent recreation
  const renderShareItem = useCallback(
    (share: SharedItem) => {
      const Icon = CONTENT_TYPE_ICONS[share.content_type];
      const today = new Date();

      // Safely access nested properties with defaults
      const expiresAt = share.access_policy?.expires_at
        ? new Date(share.access_policy.expires_at)
        : new Date();
      const daysUntilExpiry = differenceInDays(expiresAt, today);
      const isExpiringSoon = daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
      const permissions = share.access_policy?.permissions ?? [];
      const canDownload =
        permissions.includes("download") && share.classification !== "phi";

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
                    {share.owner_name && ` from @${share.owner_name}`}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {share.classification === "phi" && (
                  <Badge variant="destructive" className="text-xs">
                    PHI
                  </Badge>
                )}
                {isExpiringSoon && (
                  <Badge variant="outline" className="text-xs text-amber-600">
                    <AlertTriangle
                      className="h-3 w-3 mr-1"
                      aria-hidden="true"
                    />
                    <span>
                      {daysUntilExpiry} day{daysUntilExpiry !== 1 ? "s" : ""}
                    </span>
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden="true" />
                <span>
                  {formatDistanceToNow(
                    new Date(share.created_at),
                    DATE_FORMAT_OPTIONS,
                  )}
                </span>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onViewShare?.(share)}
                  aria-label={`View ${share.title}`}
                >
                  <Eye className="h-4 w-4 mr-1" aria-hidden="true" />
                  View
                </Button>
                {canDownload && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDownloadShare?.(share)}
                    aria-label={`Download ${share.title}`}
                  >
                    <Download className="h-4 w-4 mr-1" aria-hidden="true" />
                    Download
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      );
    },
    [onViewShare, onDownloadShare],
  );

  // Loading state with accessible label
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center p-8"
        role="status"
        aria-label="Loading shared content"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <span className="sr-only">Loading shared content...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-destructive">Failed to load shared content.</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Please try again later."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasResults = filteredShares.length > 0;
  const hasSearchFilter = searchQuery !== "" || typeFilter !== "all";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Shared With Me</h2>
      </div>

      {/* Search and filter controls */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Search shares..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
            aria-label="Search shared content"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) =>
            setTypeFilter(v as ShareableContentType | "all")
          }
        >
          <SelectTrigger
            className="w-[180px]"
            aria-label="Filter by content type"
          >
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(SHAREABLE_CONTENT_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Empty states - differentiate between no data and no search results */}
      {!hasResults && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <FileBarChart
              className="h-12 w-12 text-muted-foreground mb-4"
              aria-hidden="true"
            />
            {hasSearchFilter ? (
              <>
                <p className="text-muted-foreground">
                  No shares match your search criteria.
                </p>
                <p className="text-sm text-muted-foreground">
                  Try adjusting your search or filter.
                </p>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  No content has been shared with you yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  When colleagues share content, it will appear here.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grouped share lists */}
      {hasResults && (
        <div className="space-y-4">
          {groupedShares.today.length > 0 && (
            <section aria-labelledby="today-heading">
              <h3
                id="today-heading"
                className="text-sm font-medium text-muted-foreground mb-2"
              >
                Today
              </h3>
              {groupedShares.today.map(renderShareItem)}
            </section>
          )}

          {groupedShares.thisWeek.length > 0 && (
            <section aria-labelledby="this-week-heading">
              <h3
                id="this-week-heading"
                className="text-sm font-medium text-muted-foreground mb-2"
              >
                This Week
              </h3>
              {groupedShares.thisWeek.map(renderShareItem)}
            </section>
          )}

          {groupedShares.older.length > 0 && (
            <section aria-labelledby="older-heading">
              <h3
                id="older-heading"
                className="text-sm font-medium text-muted-foreground mb-2"
              >
                Older
              </h3>
              {groupedShares.older.map(renderShareItem)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
