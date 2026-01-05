/**
 * FederationSettings - Manage federation with other institutions
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { useClipboard } from "@/hooks/useClipboard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2,
  Plus,
  Link2,
  Copy,
  Check,
  Trash2,
  Clock,
  Shield,
  Eye,
  Ban,
  Loader2,
} from "lucide-react";
import {
  useFederatedInstitutions,
  usePendingInvites,
  useCreateInvite,
  useRevokeInvite,
  useRevokeTrust,
  useUpdateTrustLevel,
} from "@/hooks/useFederation";
import { TRUST_LEVEL_LABELS, isInviteValid } from "@/types/sync";
import type {
  FederatedInstitutionSummary,
  FederationInvite,
  TrustLevel,
} from "@/types/sync";
import { format, formatDistanceToNow } from "date-fns";

interface FederationSettingsProps {
  institutionId: string;
  institutionName: string;
}

export function FederationSettings({
  institutionId,
  institutionName,
}: FederationSettingsProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [expiryDays, setExpiryDays] = useState("7");

  // Use clipboard hook for proper cleanup
  const { copied, copiedValue, copy } = useClipboard({
    onSuccess: () => toast.success("Copied", "Invite link copied to clipboard"),
    onError: (err) => toast.error("Copy failed", err.message),
  });

  const { data: federatedInstitutions, isLoading: loadingInstitutions } =
    useFederatedInstitutions(institutionId);
  const { data: pendingInvites, isLoading: loadingInvites } =
    usePendingInvites(institutionId);
  const { mutateAsync: createInvite, isPending: isCreating } =
    useCreateInvite();
  const { mutateAsync: revokeInvite, isPending: isRevokingInvite } =
    useRevokeInvite();
  const { mutateAsync: revokeTrust, isPending: isRevokingTrust } =
    useRevokeTrust();
  const { mutateAsync: updateTrustLevel } = useUpdateTrustLevel();

  const handleCreateInvite = useCallback(async () => {
    try {
      const result = await createInvite({
        institutionId,
        toInstitutionName: inviteName.trim() || undefined,
        expiryDays: parseInt(expiryDays, 10),
      });
      setCreateDialogOpen(false);
      setInviteName("");

      // Copy the share URL to clipboard using hook
      await copy(result.share_url);
      toast.success(
        "Invite created",
        "The invite link has been copied to your clipboard",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create invite";
      toast.error("Create failed", message);
    }
  }, [createInvite, institutionId, inviteName, expiryDays, copy]);

  const handleCopyToken = useCallback(
    async (token: string) => {
      const url = `ddalab://federation/accept?token=${token}`;
      await copy(url);
    },
    [copy],
  );

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      try {
        await revokeInvite(inviteId);
        toast.success("Invite revoked", "The invite is no longer valid");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to revoke invite";
        toast.error("Revoke failed", message);
      }
    },
    [revokeInvite],
  );

  const handleRevokeTrust = useCallback(
    async (trustId: string, institutionName: string) => {
      try {
        await revokeTrust(trustId);
        toast.success(
          "Federation revoked",
          `Federation with ${institutionName} has been revoked`,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to revoke federation";
        toast.error("Revoke failed", message);
      }
    },
    [revokeTrust],
  );

  const handleUpdateTrustLevel = useCallback(
    async (trustId: string, newLevel: TrustLevel, institutionName: string) => {
      try {
        await updateTrustLevel({ trustId, trustLevel: newLevel });
        toast.success(
          "Trust level updated",
          `${institutionName} is now ${TRUST_LEVEL_LABELS[newLevel]}`,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update trust level";
        toast.error("Update failed", message);
      }
    },
    [updateTrustLevel],
  );

  const getTrustLevelIcon = (level: TrustLevel) => {
    switch (level) {
      case "full":
        return <Shield className="h-4 w-4 text-green-500" aria-hidden="true" />;
      case "read_only":
        return <Eye className="h-4 w-4 text-amber-500" aria-hidden="true" />;
      case "revoked":
        return <Ban className="h-4 w-4 text-destructive" aria-hidden="true" />;
    }
  };

  // Helper to check if a token is the currently copied one
  const isTokenCopied = (token: string) => {
    return (
      copied && copiedValue === `ddalab://federation/accept?token=${token}`
    );
  };

  if (loadingInstitutions || loadingInvites) {
    return (
      <div
        className="flex items-center justify-center p-8"
        role="status"
        aria-label="Loading federation settings"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <span className="sr-only">Loading federation settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Federation</h2>
          <p className="text-sm text-muted-foreground">
            Connect with other institutions to share non-PHI content
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              Invite Institution
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Federation Invite</DialogTitle>
              <DialogDescription>
                Generate an invite link that another institution can use to
                establish a trusted connection with {institutionName}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-name">
                  Recipient Institution Name (optional)
                </Label>
                <Input
                  id="invite-name"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="e.g., Stanford University"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiry">Invite Expires In</Label>
                <Select value={expiryDays} onValueChange={setExpiryDays}>
                  <SelectTrigger id="expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateInvite} disabled={isCreating}>
                {isCreating ? "Creating..." : "Create & Copy Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="institutions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="institutions">
            Federated Institutions ({federatedInstitutions?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="invites">
            Pending Invites ({pendingInvites?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="institutions">
          {federatedInstitutions?.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <Building2
                  className="h-12 w-12 text-muted-foreground mb-4"
                  aria-hidden="true"
                />
                <p className="text-muted-foreground">
                  No federated institutions yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  Create an invite to connect with another institution.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {federatedInstitutions?.map(
                (inst: FederatedInstitutionSummary) => (
                  <Card key={inst.institution_id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Building2 className="h-4 w-4" aria-hidden="true" />
                            {inst.institution_name}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Federated{" "}
                            {formatDistanceToNow(
                              new Date(inst.established_at),
                              {
                                addSuffix: true,
                              },
                            )}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              inst.trust_level === "full"
                                ? "default"
                                : inst.trust_level === "read_only"
                                  ? "secondary"
                                  : "destructive"
                            }
                            className="flex items-center gap-1"
                          >
                            {getTrustLevelIcon(inst.trust_level)}
                            {TRUST_LEVEL_LABELS[inst.trust_level]}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline">
                          {inst.share_count} shared item
                          {inst.share_count !== 1 ? "s" : ""}
                        </Badge>
                        <div className="flex gap-2">
                          <Select
                            value={inst.trust_level}
                            onValueChange={(value) =>
                              handleUpdateTrustLevel(
                                inst.institution_id,
                                value as TrustLevel,
                                inst.institution_name,
                              )
                            }
                          >
                            <SelectTrigger
                              className="w-[140px]"
                              aria-label={`Trust level for ${inst.institution_name}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="full">Full Access</SelectItem>
                              <SelectItem value="read_only">
                                Read Only
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isRevokingTrust}
                                aria-label={`Revoke federation with ${inst.institution_name}`}
                              >
                                <Trash2
                                  className="h-4 w-4 text-destructive"
                                  aria-hidden="true"
                                />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Revoke Federation
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to revoke the federation
                                  with {inst.institution_name}? They will no
                                  longer be able to access your shared content.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() =>
                                    handleRevokeTrust(
                                      inst.institution_id,
                                      inst.institution_name,
                                    )
                                  }
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
                ),
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="invites">
          {pendingInvites?.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <Link2
                  className="h-12 w-12 text-muted-foreground mb-4"
                  aria-hidden="true"
                />
                <p className="text-muted-foreground">No pending invites.</p>
                <p className="text-sm text-muted-foreground">
                  Create an invite to share with another institution.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {pendingInvites?.map((invite: FederationInvite) => (
                <Card
                  key={invite.id}
                  className={!isInviteValid(invite) ? "opacity-60" : ""}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">
                          {invite.to_institution_name || "Any Institution"}
                        </CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-2">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          Expires{" "}
                          {format(new Date(invite.expires_at), "MMM d, yyyy")}
                        </CardDescription>
                      </div>
                      {!isInviteValid(invite) && (
                        <Badge variant="destructive">Expired</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[200px]">
                        {invite.invite_token.slice(0, 16)}...
                      </code>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyToken(invite.invite_token)}
                          disabled={!isInviteValid(invite)}
                          aria-label={`Copy invite link for ${invite.to_institution_name || "any institution"}`}
                        >
                          {isTokenCopied(invite.invite_token) ? (
                            <>
                              <Check
                                className="h-4 w-4 mr-1 text-green-500"
                                aria-hidden="true"
                              />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy
                                className="h-4 w-4 mr-1"
                                aria-hidden="true"
                              />
                              Copy Link
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRevokeInvite(invite.id)}
                          disabled={isRevokingInvite}
                          aria-label={`Revoke invite for ${invite.to_institution_name || "any institution"}`}
                        >
                          <Trash2
                            className="h-4 w-4 text-destructive"
                            aria-hidden="true"
                          />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
