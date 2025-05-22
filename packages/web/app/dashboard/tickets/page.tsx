"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { useToast } from "shared/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "shared";
import { fetchTickets } from "shared/src/store/slices/ticketsSlice";
import { ProtectedRoute } from "shared/components/higher-order/ProtectedRoute";
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

interface RootState {
  tickets: {
    tickets: Ticket[];
    loading: boolean;
    error: string | null;
    currentTicket: Ticket | null;
  };
}

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const TicketCard = ({ ticket }: { ticket: Ticket }) => (
  <Card className="mb-4">
    <CardHeader className="pb-2">
      <div className="flex justify-between items-start">
        <div>
          <CardTitle className="text-lg">{ticket.title}</CardTitle>
          <CardDescription className="mt-1">
            Created by {ticket.createdBy} • {formatDate(ticket.createdAt)}
          </CardDescription>
        </div>
        <Badge variant={ticket.status === "resolved" ? "success" : "default"}>
          {ticket.status}
        </Badge>
      </div>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">{ticket.description}</p>
      <div className="mt-3 flex justify-between items-center">
        <Badge variant="outline" className="capitalize">
          {ticket.priority} priority
        </Badge>
        {ticket.assignedTo && (
          <span className="text-xs text-muted-foreground">
            Assigned to: {ticket.assignedTo}
          </span>
        )}
      </div>
    </CardContent>
  </Card>
);

const TicketsPage = () => {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const dispatch = useAppDispatch();

  // Use the RootState type with useAppSelector
  const { tickets, loading, error } = useAppSelector(
    (state: RootState) => state.tickets
  );

  // Filter tickets
  const openTickets = tickets.filter(
    (ticket: Ticket) =>
      ticket.status === "open" || ticket.status === "in-progress"
  );

  const resolvedTickets = tickets.filter(
    (ticket: Ticket) =>
      ticket.status === "resolved" || ticket.status === "closed"
  );

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated") {
      dispatch(fetchTickets());
    }
  }, [status, router, dispatch]);

  const handleRefresh = () => {
    dispatch(fetchTickets());
    toast({
      title: "Refreshing tickets...",
      description: "Fetching the latest ticket data.",
    });
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-500">Error loading tickets: {error}</div>
        <Button onClick={handleRefresh} variant="outline" className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Support Tickets</h1>
        <div className="flex space-x-2">
          <Button onClick={handleRefresh} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button>New Ticket</Button>
        </div>
      </div>

      <Tabs defaultValue="open" className="space-y-4">
        <TabsList>
          <TabsTrigger value="open">Open ({openTickets.length})</TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved ({resolvedTickets.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="space-y-4">
          {openTickets.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                No open tickets found.
              </CardContent>
            </Card>
          ) : (
            openTickets.map((ticket: Ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))
          )}
        </TabsContent>

        <TabsContent value="resolved" className="space-y-4">
          {resolvedTickets.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                No resolved tickets found.
              </CardContent>
            </Card>
          ) : (
            resolvedTickets.map((ticket: Ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

const TicketsPageComponent = () => {
  const { data: session, status } = useSession();
  const router = useRouter();
  const dispatch = useAppDispatch();

  // Use the RootState type with useAppSelector
  const { tickets, loading, error } = useAppSelector(
    (state: RootState) => state.tickets
  );

  // Filter tickets with proper typing
  const openTickets = tickets.filter(
    (ticket: Ticket) =>
      ticket.status === "open" || ticket.status === "in-progress"
  );

  const resolvedTickets = tickets.filter(
    (ticket: Ticket) =>
      ticket.status === "resolved" || ticket.status === "closed"
  );

  // Fetch tickets when component mounts
  useEffect(() => {
    if (status === "authenticated") {
      dispatch(fetchTickets());
    }
  }, [dispatch, status]);

  const handleRefresh = () => {
    dispatch(fetchTickets());
  };

  const handleTicketClick = (ticketId: string) => {
    router.push(`/dashboard/tickets/${ticketId}`);
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
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Tickets</h1>
            <p className="text-muted-foreground">
              Manage and track support tickets
            </p>
          </div>
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
                <p className="text-sm">{error}</p>
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
      </div>
    </ProtectedRoute>
  );
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "open":
      return <Badge variant="default">Open</Badge>;
    case "in-progress":
      return <Badge variant="secondary">In Progress</Badge>;
    case "resolved":
      return <Badge variant="success">Resolved</Badge>;
    case "closed":
      return <Badge variant="outline">Closed</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
};

export default TicketsPageComponent;
