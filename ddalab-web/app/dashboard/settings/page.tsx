"use client";

import { useAuth } from "@/contexts/auth-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";

export default function SettingsPage() {
  const { user } = useAuth();

  if (!user) {
    return <div>Loading user information...</div>;
  }

  // Get initials for avatar fallback
  const getInitials = () => {
    if (user.name) {
      return user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase();
    }
    return user.username.substring(0, 2).toUpperCase();
  };

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">User Settings</h1>

      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <Avatar className="h-16 w-16">
              <AvatarImage
                src={`https://avatar.vercel.sh/${user.username}`}
                alt={user.name || user.username}
              />
              <AvatarFallback>{getInitials()}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>{user.name || user.username}</CardTitle>
              <CardDescription>Profile Information</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Username
              </Label>
              <div className="text-lg">{user.username}</div>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Email
              </Label>
              <div className="text-lg">{user.email || "Not provided"}</div>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Role
              </Label>
              <div className="text-lg">{user.role || "User"}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
