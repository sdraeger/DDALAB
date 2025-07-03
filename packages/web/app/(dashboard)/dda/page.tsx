"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useMutation } from "@apollo/client";
import { Loader2 } from "lucide-react";
// DashboardLayout is now handled at the layout level
import { Button } from "shared/components/ui/button";
import { Input } from "shared/components/ui/input";
import { Label } from "shared/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "shared/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "shared/components/ui/alert";
import { DDAResults } from "shared/components/DDAResults";
import { SUBMIT_DDA_TASK } from "shared/lib/graphql/mutations";
import { useToast } from "shared/components/ui/use-toast";

export default function DDAPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [filePath, setFilePath] = useState("");
  const [channelList, setChannelList] = useState("");
  const [serverConfigError, setServerConfigError] = useState<string | null>(
    null
  );
  const [runDda, { loading, error, data }] = useMutation(SUBMIT_DDA_TASK);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.accessToken) return;

    setServerConfigError(null);

    try {
      const channels = channelList
        .split(",")
        .map((ch) => parseInt(ch.trim()))
        .filter((ch) => !isNaN(ch));
      const result = await runDda({
        variables: {
          filePath,
          channelList: channels,
          preprocessingOptions: {}, // Add options as needed
          maxHeatmapPoints: 100000, // Downsample to 100k points
        },
        context: {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        },
      });

      // Check for server configuration errors
      if (result.data?.runDda?.error === "DDA_BINARY_INVALID") {
        setServerConfigError(
          result.data.runDda.error_message ||
          "DDA binary is not properly configured on the server"
        );
        toast({
          title: "Server Configuration Error",
          description:
            "The DDA binary is not properly configured. Please contact your administrator.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: "DDA task completed successfully",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to run DDA task",
        variant: "destructive",
      });
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Run DDA</h1>
        <p className="text-muted-foreground">Submit a DDA task</p>
      </div>
      {serverConfigError && (
        <Alert variant="destructive">
          <AlertTitle>Server Configuration Error</AlertTitle>
          <AlertDescription>
            The DDA binary is not properly configured on the server.
            {serverConfigError && ` Details: ${serverConfigError}`}
            <br />
            Please contact your administrator to resolve this issue.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>DDA Task</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="filePath">File Path</Label>
              <Input
                id="filePath"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="Enter file path"
              />
            </div>
            <div>
              <Label htmlFor="channelList">
                Channel List (comma-separated)
              </Label>
              <Input
                id="channelList"
                value={channelList}
                onChange={(e) => setChannelList(e.target.value)}
                placeholder="e.g., 1,2,3"
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                "Run DDA"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      {error && (
        <Card>
          <CardContent className="py-6 text-destructive">
            <p>Failed to run DDA task: {error.message}</p>
          </CardContent>
        </Card>
      )}
      {data?.runDda && !data.runDda.error && (
        <DDAResults
          result={{
            artifact_id: data.runDda.artifactId || "temp-id", // Backend should return artifact_id
            file_path: data.runDda.filePath,
            Q: data.runDda.Q,
            metadata: data.runDda.metadata,
          }}
        />
      )}
    </div>
  );
}
