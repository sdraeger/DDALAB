"use client";

import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";
import { Textarea } from "./textarea";
import { useToast } from "../../hooks/use-toast";
import { useSession } from "next-auth/react";
import { apiRequest } from "../../lib/utils/request";

export function HelpButton() {
  const { data: session, status } = useSession();
  const isLoggedIn = !!session;
  const _loading = status === "loading";
  const [isLoading, setIsLoading] = useState(false);
  const loading = _loading || isLoading;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Function to submit a help ticket
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

      const response = await apiRequest({
        url: `/api/tickets`,
        method: "POST",
        body: { title, description },
        contentType: "application/json",
        token: token,
        responseType: "json",
      });

      console.log("Ticket created successfully:", response);

      toast({
        title: "Ticket submitted",
        description: "Your help ticket has been submitted successfully",
      });

      // Reset form and close dialog
      setTitle("");
      setDescription("");
      setOpen(false);
    } catch (error) {
      console.error("Error submitting ticket:", error);
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

  // Only show the help button if the user is logged in
  if (!isLoggedIn) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Get help">
          <LifeBuoy className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Get Help</DialogTitle>
          <DialogDescription>
            Submit a help ticket and someone will get back to you shortly. You
            can submit bug reports, feature requests, or other issues.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Brief description of your issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Please provide details about your issue..."
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" onClick={submitTicket} disabled={loading}>
            {loading ? "Submitting..." : "Submit Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
