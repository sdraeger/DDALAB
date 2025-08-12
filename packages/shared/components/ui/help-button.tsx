"use client";

import { useState } from "react";
import { useToast } from "../../hooks/useToast";
import { post } from "../../lib/utils/request";
import { TicketDialog } from "../dialog/TicketDialog";
import { useUnifiedSessionData } from "../../hooks/useUnifiedSession";

export function HelpButton() {
  const { data: session, status } = useUnifiedSessionData();
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

      await post(
        "/api/tickets",
        { title, description },
        token
      );

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
