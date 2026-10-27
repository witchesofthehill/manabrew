import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-ui-label font-medium transition-colors touch:min-h-11 touch:min-w-11 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-']):not([class*='h-']):not([class*='w-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow hover:bg-primary-hover active:brightness-95",
        secondary:
          "border border-secondary/60 bg-secondary/10 text-foreground hover:bg-secondary/20",
        outline: "border border-input bg-background shadow-sm hover:bg-muted hover:text-foreground",
        ghost: "hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:brightness-110 active:brightness-95",
        "destructive-quiet":
          "border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive",
        selected:
          "border border-selection-border bg-selection text-selection-foreground shadow-sm hover:brightness-110",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        xs: "min-h-7 rounded-md px-2 py-1",
        sm: "min-h-8 rounded-md px-3 py-1",
        lg: "min-h-10 rounded-md px-8 py-2 touch:min-h-12",
        "icon-xs": "h-6 w-6",
        "icon-sm": "h-7 w-7",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, "variant"> {
  variant: ButtonVariant;
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={asChild ? type : (type ?? "button")}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
