import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, ...props }, ref) => (
  <input
    autoComplete="off"
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-transparent py-1 pl-3 pr-3 text-sm transition-colors duration-150 hover:duration-0 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 max-md:pointer-coarse:h-10 max-md:pointer-coarse:text-base",
      className,
    )}
    ref={ref}
    {...props}
  />
));
