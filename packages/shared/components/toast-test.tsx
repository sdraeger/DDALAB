"use client";

import { Button } from "./ui/button";
import { useToast } from "./ui/use-toast";

export function ToastTest() {
  const { toast } = useToast();

  const showToast = () => {
    toast({
      title: "Toast Test",
      description: "This is a test toast notification",
      duration: 3000,
    });
  };

  return (
    <Button onClick={showToast} variant="outline" size="sm">
      Test Toast
    </Button>
  );
}
