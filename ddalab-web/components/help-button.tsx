"use client";

import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export function HelpButton() {
  const { isLoggedIn, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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
      setLoading(true);

      // Get the auth token from localStorage
      const token = localStorage.getItem("ddalab_auth_token");

      // Use the Next.js API route which will proxy to the correct backend endpoint
      const response = await fetch(`/api/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          description,
        }),
      });

      // Try to parse the response even if it's not OK, to get error details
      let data;
      try {
        const textResponse = await response.text();
        data = textResponse ? JSON.parse(textResponse) : {};
      } catch (parseError) {
        console.error("Failed to parse response:", parseError);
        data = { error: "Failed to parse server response" };
      }

      // Check if response is OK
      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.error ||
            `Server responded with status ${response.status}`
        );
      }

      console.log("Ticket created successfully:", data);

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
      setLoading(false);
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
            Submit a help ticket and our support team will assist you shortly.
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
