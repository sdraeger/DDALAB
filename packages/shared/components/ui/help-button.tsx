"use client";

import { useState } from "react";
import { useToast } from "../../hooks/use-toast";
import { useSession } from "next-auth/react";
import { apiRequest } from "../../lib/utils/request";
import { TicketDialog } from "../dialog/TicketDialog";

export function HelpButton() {
  const { data: session, status } = useSession();
  const isLoggedIn = !!session;
  const [isLoading, setIsLoading] = useState(false);
  const loading = status === "loading" || isLoading;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submitTicket = async () => {
    if (!title.trim() || !description.trim()) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);
      const token = session?.accessToken;
      if (!token) throw new Error("No token found in session");

      await apiRequest({
        url: "/api/tickets",
        method: "POST",
        body: { title, description },
        contentType: "application/json",
        token,
        responseType: "json",
      });

      toast({
        title: "Ticket Submitted",
        description: "Your help ticket has been submitted successfully",
      });

      setTitle("");
      setDescription("");
      setOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isLoggedIn) {
    return null;
  }

  return (
    <TicketDialog
      mode="submit"
      title={title}
      description={description}
      open={open}
      setOpen={setOpen}
      setTitle={setTitle}
      setDescription={setDescription}
      onSubmit={submitTicket}
      loading={loading}
    />
  );
}
