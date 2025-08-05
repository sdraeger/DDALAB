"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { useApiQuery } from "shared/hooks/useApiQuery";
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
import { useUnifiedSession } from "shared/hooks/useUnifiedSession";
import { useAuthMode } from "shared/contexts/AuthModeContext";

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
  const { user, status } = useUnifiedSession();
  const { authMode } = useAuthMode();
  const router = useRouter();
  const { toast } = useToast();
  const [ticketDialogTitle, setTicketDialogTitle] = useState("");
  const [ticketDialogDescription, setTicketDialogDescription] = useState("");
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);

  // Stabilize the token to prevent unnecessary re-renders
  const token = useMemo(() => user?.accessToken, [user?.accessToken]);

  // Only enable API query when we have a stable authenticated status AND auth mode is determined
  const shouldMakeRequest = useMemo(() => {
    const isAuthenticated = status === "authenticated" && !!user;
    const hasStableAuthMode = !!authMode;

    return isAuthenticated && hasStableAuthMode;
  }, [status, user, authMode]);

  const {
    data: tickets,
    isLoading,
    error,
    refetch,
  } = useApiQuery<Ticket[]>({
    queryKey: ["tickets"],
    url: "/api/tickets",
    enabled: shouldMakeRequest,
    token,
  });

  const handleCreateTicket = useCallback(async () => {
    if (!ticketDialogTitle.trim() || !ticketDialogDescription.trim()) {
      toast({
        title: "Error",
        description: "Please fill in both title and description",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          title: ticketDialogTitle,
          description: ticketDialogDescription,
          status: "open",
          priority: "medium",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create ticket");
      }

      toast({
        title: "Success",
        description: "Ticket created successfully",
      });

      setTicketDialogTitle("");
      setTicketDialogDescription("");
      setTicketDialogOpen(false);
      refetch();
    } catch (error) {
      console.error("Error creating ticket:", error);
      toast({
        title: "Error",
        description: "Failed to create ticket",
        variant: "destructive",
      });
    }
  }, [ticketDialogTitle, ticketDialogDescription, token, toast, refetch]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "in-progress":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "resolved":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "closed":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "low":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "medium":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "high":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      case "critical":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (!shouldMakeRequest) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          <p className="mt-2 text-sm text-muted-foreground">
            Initializing session...
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          <p className="mt-2 text-sm text-muted-foreground">
            Loading tickets...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Error loading tickets: {error.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-2"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const openTickets = tickets?.filter((ticket) => ticket.status === "open") || [];
  const inProgressTickets = tickets?.filter((ticket) => ticket.status === "in-progress") || [];
  const resolvedTickets = tickets?.filter((ticket) => ticket.status === "resolved") || [];
  const closedTickets = tickets?.filter((ticket) => ticket.status === "closed") || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Help Tickets</h1>
          <p className="text-muted-foreground">
            Manage and track support requests
          </p>
        </div>
        <Button onClick={() => setTicketDialogOpen(true)}>
          Create Ticket
        </Button>
      </div>

      <Tabs defaultValue="open" className="space-y-4">
        <TabsList>
          <TabsTrigger value="open">
            Open ({openTickets.length})
          </TabsTrigger>
          <TabsTrigger value="in-progress">
            In Progress ({inProgressTickets.length})
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved ({resolvedTickets.length})
          </TabsTrigger>
          <TabsTrigger value="closed">
            Closed ({closedTickets.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="space-y-4">
          {openTickets.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  No open tickets
                </p>
              </CardContent>
            </Card>
          ) : (
            openTickets.map((ticket) => (
              <Card key={ticket.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{ticket.title}</CardTitle>
                    <div className="flex gap-2">
                      <Badge className={getPriorityColor(ticket.priority)}>
                        {ticket.priority}
                      </Badge>
                      <Badge className={getStatusColor(ticket.status)}>
                        {ticket.status}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>
                    Created by {ticket.createdBy} on{" "}
                    {new Date(ticket.createdAt).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{ticket.description}</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="in-progress" className="space-y-4">
          {inProgressTickets.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  No tickets in progress
                </p>
              </CardContent>
            </Card>
          ) : (
            inProgressTickets.map((ticket) => (
              <Card key={ticket.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{ticket.title}</CardTitle>
                    <div className="flex gap-2">
                      <Badge className={getPriorityColor(ticket.priority)}>
                        {ticket.priority}
                      </Badge>
                      <Badge className={getStatusColor(ticket.status)}>
                        {ticket.status}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>
                    Created by {ticket.createdBy} on{" "}
                    {new Date(ticket.createdAt).toLocaleDateString()}
                    {ticket.assignedTo && ` • Assigned to ${ticket.assignedTo}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{ticket.description}</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="resolved" className="space-y-4">
          {resolvedTickets.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  No resolved tickets
                </p>
              </CardContent>
            </Card>
          ) : (
            resolvedTickets.map((ticket) => (
              <Card key={ticket.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{ticket.title}</CardTitle>
                    <div className="flex gap-2">
                      <Badge className={getPriorityColor(ticket.priority)}>
                        {ticket.priority}
                      </Badge>
                      <Badge className={getStatusColor(ticket.status)}>
                        {ticket.status}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>
                    Created by {ticket.createdBy} on{" "}
                    {new Date(ticket.createdAt).toLocaleDateString()} •
                    Resolved on {new Date(ticket.updatedAt).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{ticket.description}</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="closed" className="space-y-4">
          {closedTickets.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  No closed tickets
                </p>
              </CardContent>
            </Card>
          ) : (
            closedTickets.map((ticket) => (
              <Card key={ticket.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{ticket.title}</CardTitle>
                    <div className="flex gap-2">
                      <Badge className={getPriorityColor(ticket.priority)}>
                        {ticket.priority}
                      </Badge>
                      <Badge className={getStatusColor(ticket.status)}>
                        {ticket.status}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>
                    Created by {ticket.createdBy} on{" "}
                    {new Date(ticket.createdAt).toLocaleDateString()} •
                    Closed on {new Date(ticket.updatedAt).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{ticket.description}</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <TicketDialog
        open={ticketDialogOpen}
        onOpenChange={setTicketDialogOpen}
        title={ticketDialogTitle}
        onTitleChange={setTicketDialogTitle}
        description={ticketDialogDescription}
        onDescriptionChange={setTicketDialogDescription}
        onSubmit={handleCreateTicket}
      />
    </div>
  );
};

export default TicketsPageComponent;
