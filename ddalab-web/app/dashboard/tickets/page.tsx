"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  getAuthToken,
  isTokenExpired,
  logoutUser,
  secureFetch,
} from "@/lib/auth";
import { useRouter } from "next/navigation";

type Ticket = {
  id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  created_at: string;
  updated_at?: string;
};

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const fetchTickets = async () => {
    setLoading(true);
    setError(null);

    try {
      // Use our Next.js API route with secureFetch
      const endpoint = `/api/tickets`;
      console.log("Fetching tickets from:", endpoint);

      const response = await secureFetch(endpoint, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log(
        "Tickets API response status:",
        response.status,
        response.statusText
      );

      // If response is 401 (Unauthorized), handle expired token
      if (response.status === 401) {
        console.error("Token is invalid or expired");
        toast({
          title: "Session Expired",
          description: "Your session has expired. Please log in again.",
          variant: "destructive",
        });
        logoutUser();
        router.push("/login");
        return;
      }

      // If response isn't ok, try to get error details
      if (!response.ok) {
        let errorMessage = `Failed to fetch tickets (status ${response.status})`;

        try {
          const textResponse = await response.text();
          if (textResponse) {
            const errorData = JSON.parse(textResponse);
            console.error("API error response:", errorData);
            // Check for both error and detail fields in the error response
            errorMessage = errorData.detail || errorData.error || errorMessage;
          }
        } catch (parseError) {
          console.error("Could not parse error response:", parseError);
        }

        throw new Error(errorMessage);
      }

      // Try to parse the successful response
      let data;
      try {
        const textResponse = await response.text();
        data = textResponse ? JSON.parse(textResponse) : [];
      } catch (parseError) {
        console.error("Failed to parse success response:", parseError);
        throw new Error("Failed to parse server response");
      }

      console.log("Received tickets:", data);
      setTickets(Array.isArray(data) ? data : []);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";

      console.error("Ticket fetch error:", errorMessage);
      setError(errorMessage);

      // Handle authentication errors
      if (
        errorMessage.includes("authentication") ||
        errorMessage.includes("token") ||
        errorMessage.includes("log in")
      ) {
        logoutUser();
        router.push("/login");
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check token validity before fetching
    if (isTokenExpired()) {
      toast({
        title: "Session Expired",
        description: "Your session has expired. Please log in again.",
        variant: "destructive",
      });
      logoutUser();
      router.push("/login");
      return;
    }

    fetchTickets();
  }, [router]);

  // Filter tickets based on status
  const openTickets = tickets.filter(
    (ticket) => ticket.status === "open" || ticket.status === "in_progress"
  );
  const resolvedTickets = tickets.filter(
    (ticket) => ticket.status === "resolved" || ticket.status === "closed"
  );

  // Function to display ticket status with appropriate color
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge variant="default">Open</Badge>;
      case "in_progress":
        return <Badge variant="secondary">In Progress</Badge>;
      case "resolved":
        return <Badge variant="success">Resolved</Badge>;
      case "closed":
        return <Badge variant="outline">Closed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // Format date to a more readable format
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <ProtectedRoute>
      <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center p-4 md:p-8">
        <div className="w-full max-w-7xl">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">Help Tickets</h1>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchTickets}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          {loading && tickets.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-6">
                <div className="text-center text-destructive">
                  <p>Failed to load tickets. Please try again.</p>
                  <p className="text-sm">{error}</p>
                </div>
              </CardContent>
            </Card>
          ) : tickets.length === 0 ? (
            <Card>
              <CardContent className="py-6">
                <p className="text-center text-muted-foreground">
                  You haven't submitted any help tickets yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Tabs defaultValue="active">
              <TabsList className="mb-6">
                <TabsTrigger value="active">
                  Active Tickets
                  {openTickets.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {openTickets.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="resolved">
                  Resolved Tickets
                  {resolvedTickets.length > 0 && (
                    <Badge variant="outline" className="ml-2">
                      {resolvedTickets.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="active" className="space-y-4">
                {openTickets.length === 0 ? (
                  <Card>
                    <CardContent className="py-6">
                      <p className="text-center text-muted-foreground">
                        No active tickets found.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  openTickets.map((ticket) => (
                    <Card key={ticket.id}>
                      <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle>{ticket.title}</CardTitle>
                            <CardDescription>
                              Created: {formatDate(ticket.created_at)}
                            </CardDescription>
                          </div>
                          <div>{getStatusBadge(ticket.status)}</div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="whitespace-pre-line">
                          {ticket.description}
                        </p>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              <TabsContent value="resolved" className="space-y-4">
                {resolvedTickets.length === 0 ? (
                  <Card>
                    <CardContent className="py-6">
                      <p className="text-center text-muted-foreground">
                        No resolved tickets found.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  resolvedTickets.map((ticket) => (
                    <Card key={ticket.id}>
                      <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle>{ticket.title}</CardTitle>
                            <CardDescription>
                              Created: {formatDate(ticket.created_at)}
                              {ticket.updated_at &&
                                ` • Updated: ${formatDate(ticket.updated_at)}`}
                            </CardDescription>
                          </div>
                          <div>{getStatusBadge(ticket.status)}</div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="whitespace-pre-line">
                          {ticket.description}
                        </p>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
