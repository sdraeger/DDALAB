import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { LifeBuoy } from "lucide-react";

interface TicketDialogProps {
  mode: "submit" | "readonly";
  title: string;
  description: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  setTitle?: (title: string) => void;
  setDescription?: (description: string) => void;
  onSubmit?: () => void;
  loading?: boolean;
}

export function TicketDialog({
  mode,
  title,
  description,
  open,
  setOpen,
  setTitle,
  setDescription,
  onSubmit,
  loading = false,
}: TicketDialogProps) {
  const isSubmitMode = mode === "submit";
  const dialogTitle = isSubmitMode ? "Get Help" : "Ticket Details";
  const descriptionPlaceholder = isSubmitMode
    ? "Please provide details about your issue..."
    : "Description of the issue";
  const triggerLabel = isSubmitMode ? "Get help" : "View ticket";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={triggerLabel}>
          <LifeBuoy className="h-5 w-5" />
        </Button>
      </DialogTrigger> */}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Brief description of the issue"
              value={title}
              onChange={
                isSubmitMode && setTitle
                  ? (e) => setTitle(e.target.value)
                  : undefined
              }
              disabled={loading || !isSubmitMode}
              readOnly={!isSubmitMode}
              tabIndex={!isSubmitMode ? -1 : undefined}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder={descriptionPlaceholder}
              rows={5}
              value={description}
              onChange={
                isSubmitMode && setDescription
                  ? (e) => setDescription(e.target.value)
                  : undefined
              }
              disabled={loading || !isSubmitMode}
              readOnly={!isSubmitMode}
              tabIndex={!isSubmitMode ? -1 : undefined}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            {isSubmitMode ? "Cancel" : "Close"}
          </Button>
          {isSubmitMode && (
            <Button type="submit" onClick={onSubmit} disabled={loading}>
              {loading ? "Submitting..." : "Submit Ticket"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
