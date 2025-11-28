import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Validation state for visual feedback */
  validationState?: "default" | "error" | "success";
  /** Error message to display (also sets validationState to error) */
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, validationState, error, ...props }, ref) => {
    // If error prop is provided, set validationState to error
    const state = error ? "error" : (validationState ?? "default");

    return (
      <div className="relative">
        <input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors duration-200",
            "placeholder:text-muted-foreground",
            "hover:border-ring/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input",
            "file:border-0 file:bg-primary/10 file:text-sm file:font-medium file:text-primary file:mr-4 file:px-4 file:py-2 file:rounded-md file:cursor-pointer file:transition-colors file:hover:bg-primary/20",
            // Validation states
            state === "error" &&
              "border-destructive focus-visible:ring-destructive/50 hover:border-destructive",
            state === "success" &&
              "border-green-500 focus-visible:ring-green-500/50 hover:border-green-500",
            className,
          )}
          ref={ref}
          aria-invalid={state === "error" ? true : undefined}
          aria-describedby={error ? `${props.id}-error` : undefined}
          {...props}
        />
        {error && (
          <p
            id={props.id ? `${props.id}-error` : undefined}
            className="text-sm text-destructive mt-1"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
