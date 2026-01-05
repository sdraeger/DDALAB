/**
 * TeamManagement - Create and manage teams within an institution
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Settings, Trash2, Loader2 } from "lucide-react";
import { useMyTeams, useCreateTeam, useDeleteTeam } from "@/hooks/useTeams";
import { toast } from "@/components/ui/toaster";
import type { TeamSummary } from "@/types/sync";

interface TeamManagementProps {
  institutionId: string;
  onTeamSelect?: (teamId: string) => void;
}

export function TeamManagement({
  institutionId,
  onTeamSelect,
}: TeamManagementProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");

  const { data: teams, isLoading } = useMyTeams();
  const { mutateAsync: createTeam, isPending: isCreating } = useCreateTeam();
  const { mutateAsync: deleteTeam, isPending: isDeleting } = useDeleteTeam();

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return;

    try {
      await createTeam({
        name: newTeamName.trim(),
        description: newTeamDescription.trim() || undefined,
        institution_id: institutionId,
      });
      setCreateDialogOpen(false);
      setNewTeamName("");
      setNewTeamDescription("");
      toast.success(
        "Team created",
        `Team "${newTeamName.trim()}" has been created`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create team";
      toast.error("Create failed", message);
    }
  }, [createTeam, newTeamName, newTeamDescription, institutionId]);

  // Handle delete with proper error handling (AlertDialog handles confirmation)
  const handleDeleteTeam = useCallback(
    async (teamId: string, teamName: string) => {
      try {
        await deleteTeam(teamId);
        toast.success("Team deleted", `Team "${teamName}" has been deleted`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to delete team";
        toast.error("Delete failed", message);
      }
    },
    [deleteTeam],
  );

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center p-8"
        role="status"
        aria-label="Loading teams"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <span className="sr-only">Loading teams...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Teams</h2>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              Create Team
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Team</DialogTitle>
              <DialogDescription>
                Create a team to share content with a group of colleagues.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="team-name">Team Name</Label>
                <Input
                  id="team-name"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="e.g., Neurology Lab"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-description">Description (optional)</Label>
                <Textarea
                  id="team-description"
                  value={newTeamDescription}
                  onChange={(e) => setNewTeamDescription(e.target.value)}
                  placeholder="What is this team for?"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateTeam}
                disabled={!newTeamName.trim() || isCreating}
              >
                {isCreating ? "Creating..." : "Create Team"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {teams?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Users
              className="h-12 w-12 text-muted-foreground mb-4"
              aria-hidden="true"
            />
            <p className="text-muted-foreground">
              You&apos;re not a member of any teams yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Create a team to start collaborating.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {teams?.map((team: TeamSummary) => (
            <Card
              key={team.id}
              className="cursor-pointer hover:border-primary transition-colors duration-200"
              onClick={() => onTeamSelect?.(team.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" aria-hidden="true" />
                      {team.name}
                    </CardTitle>
                    {team.description && (
                      <CardDescription className="mt-1">
                        {team.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTeamSelect?.(team.id);
                      }}
                      aria-label={`Settings for ${team.name}`}
                    >
                      <Settings className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => e.stopPropagation()}
                          disabled={isDeleting}
                          aria-label={`Delete ${team.name}`}
                        >
                          <Trash2
                            className="h-4 w-4 text-destructive"
                            aria-hidden="true"
                          />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Team</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete &quot;{team.name}
                            &quot;? This action cannot be undone and all team
                            shares will be revoked.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteTeam(team.id, team.name)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <Badge variant="secondary">
                    {team.member_count} member
                    {team.member_count !== 1 ? "s" : ""}
                  </Badge>
                  <Badge variant="outline">
                    {team.share_count} shared item
                    {team.share_count !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
