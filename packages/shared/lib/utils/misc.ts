import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extract initials from a name (e.g., "John Doe" -> "JD") or use first 2 letters of username
 */
export function getInitials(name?: string, username?: string): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  }

  if (username) {
    return username.substring(0, 2).toUpperCase();
  }

  return "U"; // Default fallback
}
