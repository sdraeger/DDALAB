import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useArtifacts } from "../../hooks/useArtifacts";
import { useToast } from "../ui/use-toast";
import { User } from "../../types/auth";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUnifiedSessionData } from "../../hooks/useUnifiedSession";

interface ShareArtifactDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  artifactId: string;
}

export const ShareArtifactDialog = ({
  open,
  setOpen,
  artifactId,
}: ShareArtifactDialogProps) => {
  const { data: session } = useUnifiedSessionData();
  const { shareArtifact } = useArtifacts();
  const { toast } = useToast();
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const {
    data: users = [],
    error,
    loading,
  } = useApiQuery<User[]>({
    url: "/api/users",
    method: "GET",
    token: session?.accessToken,
    responseType: "json",
    enabled: open && !!session?.accessToken,
  });

  if (error && open) {
    toast({
      title: "Error",
      description: "Failed to load users",
      variant: "destructive",
    });
  }

  // Ensure currentUserId is a number or undefined
  const currentUserId = session?.user?.id
    ? Number(session?.user?.id)
    : undefined;

  // Filter out current user and apply search
  const filteredUsers = users
    ?.filter((user) => {
      const userId = Number(user.id);
      return currentUserId !== undefined && userId !== currentUserId;
    })
    .filter((user) =>
      user.username.toLowerCase().includes(search.toLowerCase())
    );

  // Debug logging
  console.log("session.user.id", session?.user?.id, typeof session?.user?.id);
  console.log("currentUserId", currentUserId);
  console.log("users", users);
  console.log("filteredUsers", filteredUsers);

  const handleShare = async () => {
    if (!session?.accessToken) {
      toast({
        title: "Error",
        description: "No session token available",
        variant: "destructive",
      });
      return;
    }
    setIsLoading(true);
    try {
      await shareArtifact(session.accessToken, artifactId, selectedUserIds);
      toast({
        title: "Success",
        description: "Artifact shared successfully",
      });
      setOpen(false);
      setSelectedUserIds([]);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to share artifact",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Artifact</DialogTitle>
          <DialogDescription>
            Select users to share this artifact with.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="search">Search Users</Label>
            <Input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Enter username..."
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {isLoading ? (
              <div>Loading users...</div>
            ) : !currentUserId ? (
              <div>Session not loaded</div>
            ) : filteredUsers?.length === 0 ? (
              <div>No users found</div>
            ) : (
              filteredUsers?.map((user) => (
                <div key={user.id} className="flex items-center space-x-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(Number(user.id))}
                    onChange={(e) => {
                      const userId = Number(user.id);
                      if (e.target.checked) {
                        setSelectedUserIds([...selectedUserIds, userId]);
                      } else {
                        setSelectedUserIds(
                          selectedUserIds.filter((id) => id !== userId)
                        );
                      }
                    }}
                  />
                  <span>{user.username}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              setSelectedUserIds([]);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleShare}
            disabled={loading || !selectedUserIds.length || isLoading}
          >
            {isLoading ? "Sharing..." : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
