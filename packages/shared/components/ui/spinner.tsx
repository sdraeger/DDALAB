import { cn } from "shared/lib/utils/misc";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

const spinnerVariants = cva(
  "animate-spin rounded-full border-current border-t-transparent",
  {
    variants: {
      size: {
        default: "h-4 w-4 border-2",
        sm: "h-3 w-3 border-2",
        lg: "h-6 w-6 border-3",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

interface SpinnerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof spinnerVariants> {
  variant?: "circular" | "loader";
}

export function Spinner({
  className,
  size,
  variant = "circular",
  ...props
}: SpinnerProps) {
  if (variant === "loader") {
    return (
      <Loader2
        className={cn(
          "animate-spin",
          {
            "h-3 w-3": size === "sm",
            "h-4 w-4": size === "default",
            "h-6 w-6": size === "lg",
          },
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(spinnerVariants({ size, className }))}
      role="status"
      aria-label="Loading"
      {...props}
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}
