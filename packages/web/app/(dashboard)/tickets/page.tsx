"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { useApiQuery } from "shared/hooks/useApiQuery";
// DashboardLayout is now handled at the layout level
import { Button } from "shared/components/ui/button";
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
import { TicketDialog } from "shared/components/dialog/TicketDialog";
import { useToast } from "shared/hooks/useToast";
import { useUnifiedSessionData } from "shared/hooks";

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: "open" | "in-progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  assignedTo?: string;
}

const TicketsPageComponent = () => {
  const { data: session, status } = useUnifiedSessionData();
  const router = useRouter();
  const { toast } = useToast();
  const [ticketDialogTitle, setTicketDialogTitle] = useState("");
  const [ticketDialogDescription, setTicketDialogDescription] = useState("");
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const { data, loading, error, refetch } = useApiQuery<Ticket[]>({
    url: "/api/tickets",
    method: "GET",
    enabled: status === "authenticated",
    token: session?.accessToken,
  });

  const tickets = Array.isArray(data) ? data : [];

  const openTickets = tickets.filter(
    (ticket: Ticket) =>
      ticket.status === "open" || ticket.status === "in-progress"
  );

  const resolvedTickets = tickets.filter(
    (ticket: Ticket) =>
      ticket.status === "resolved" || ticket.status === "closed"
  );

  const handleRefresh = () => {
    refetch();
  };

  const handleTicketClick = (ticketId: string) => {
    const ticket = tickets.find((ticket: Ticket) => ticket.id === ticketId);
    if (ticket) {
      setTicketDialogTitle(ticket.title);
      setTicketDialogDescription(ticket.description);
      setTicketDialogOpen(true);
    } else {
      toast({
        title: "Ticket not found",
        description: `The ticket (id: ${ticketId}) you are looking for does not exist.`,
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
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tickets</h1>
          <p className="text-muted-foreground">
            Manage and track support tickets
          </p>
        </div>
        <TicketDialog
          title={ticketDialogTitle}
          description={ticketDialogDescription}
          open={ticketDialogOpen}
          setOpen={setTicketDialogOpen}
          mode="readonly"
        />
        <Button
          onClick={handleRefresh}
          disabled={loading}
          aria-label="Refresh tickets"
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
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-6">
            <div className="text-center text-destructive">
              <p>Failed to load tickets. Please try again.</p>
              <p className="text-sm">{error.message}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="open" className="space-y-4">
          <TabsList>
            <TabsTrigger value="open">
              Open Tickets
              {openTickets.length > 0 && (
                <Badge variant="outline" className="ml-2">
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

          <TabsContent value="open" className="space-y-4">
            {openTickets.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-center">
                  <p>No open tickets found.</p>
                </CardContent>
              </Card>
            ) : (
              openTickets.map((ticket: Ticket) => (
                <Card
                  key={ticket.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handleTicketClick(ticket.id)}
                >
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>{ticket.title}</CardTitle>
                        <CardDescription className="mt-1">
                          #{ticket.id} •{" "}
                          {new Date(ticket.createdAt).toLocaleDateString()}
                        </CardDescription>
                      </div>
                      <Badge variant="outline">{ticket.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">
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
                <CardContent className="py-6 text-center">
                  <p>No resolved tickets found.</p>
                </CardContent>
              </Card>
            ) : (
              resolvedTickets.map((ticket: Ticket) => (
                <Card
                  key={ticket.id}
                  className="opacity-75 hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={() => handleTicketClick(ticket.id)}
                >
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>{ticket.title}</CardTitle>
                        <CardDescription className="mt-1">
                          #{ticket.id} •{" "}
                          {new Date(ticket.createdAt).toLocaleDateString()}
                        </CardDescription>
                      </div>
                      <Badge variant="outline">{ticket.status}</Badge>
                    </div>
                  </CardHeader>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </>
  );
};

export default TicketsPageComponent;
