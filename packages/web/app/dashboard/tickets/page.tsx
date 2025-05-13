"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "shared/components/higher-order/ProtectedRoute";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "shared/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "shared/components/ui/tabs";
import { Badge } from "shared/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "shared/components/ui/button";
import { useToast } from "shared/hooks/use-toast";
import { useSession, signOut } from "next-auth/react";
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
  const { data: session, status } = useSession();

  const fetchTickets = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/tickets", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.accessToken}`,
        },
      });

      if (response.status === 401) {
        toast({
          title: "Session Expired",
          description: "Your session has expired. Please log in again.",
          variant: "destructive",
        });
        signOut({ callbackUrl: "/login" });
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message ||
            `Failed to fetch tickets (status ${response.status})`
        );
      }

      const data = await response.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setError(errorMessage);
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
    console.log("tickets status", status);
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (status === "authenticated") {
      fetchTickets();
    }
  }, [status, router]);

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
  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleString();

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
