import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Button } from "./button";
import { Trash2, Pencil, Share2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useArtifacts } from "../../hooks/useArtifacts";
import { ShareArtifactDialog } from "../dialog/ShareArtifactDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";
import { Artifact } from "../../store/slices/artifactsSlice";

interface ArtifactCardProps {
  artifact: Artifact;
}

export const ArtifactCard = ({ artifact }: ArtifactCardProps) => {
  const { data: session } = useSession();
  const { deleteArtifact, renameArtifact } = useArtifacts();
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newName, setNewName] = useState(artifact.name);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);

  const handleDelete = async () => {
    if (!session?.accessToken) return;
    setIsDeleting(true);
    try {
      await deleteArtifact(session.accessToken, artifact.artifact_id);
      setDeleteDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRename = async () => {
    if (!session?.accessToken) return;
    setIsRenaming(true);
    try {
      await renameArtifact(session.accessToken, artifact.artifact_id, newName);
      setRenameDialogOpen(false);
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <>
      <Card
        className="cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => {
          // Navigate to artifact details (TBD)
        }}
      >
        <CardHeader>
          <div className="flex justify-between items-start">
            <CardTitle>{artifact.name || artifact.artifact_id}</CardTitle>
            <div className="flex space-x-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setShareDialogOpen(true);
                }}
              >
                <Share2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenameDialogOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteDialogOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            File: {artifact.file_path}
          </p>
          <p className="text-sm text-muted-foreground">
            Created: {new Date(artifact.created_at).toLocaleDateString()}
          </p>
          {artifact.shared_by_user_id && (
            <p className="text-sm text-muted-foreground">
              Shared by: User #{artifact.shared_by_user_id}
            </p>
          )}
        </CardContent>
      </Card>

      <ShareArtifactDialog
        open={shareDialogOpen}
        setOpen={setShareDialogOpen}
        artifactId={artifact.artifact_id}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Artifact</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this artifact? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Artifact</DialogTitle>
            <DialogDescription>
              Enter a new name for the artifact.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNewName(artifact.name);
                setRenameDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={isRenaming || !newName.trim()}
            >
              {isRenaming ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
