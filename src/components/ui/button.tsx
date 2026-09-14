import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-']):not([class*='h-']):not([class*='w-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow hover:brightness-110 active:brightness-95",
        secondary:
          "border border-secondary/60 bg-secondary/10 text-foreground hover:bg-secondary/20",
        outline: "border border-input bg-background shadow-sm hover:bg-muted hover:text-foreground",
        ghost: "hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:brightness-110 active:brightness-95",
        "destructive-quiet":
          "border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive",
        selected:
          "border border-selection bg-selection text-selection-foreground shadow-sm hover:brightness-110",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 pointer-coarse:h-10",
        xs: "h-7 rounded-md px-2 text-xs pointer-coarse:h-10",
        sm: "h-8 rounded-md px-3 text-xs pointer-coarse:h-10",
        lg: "h-10 rounded-md px-8 pointer-coarse:h-11",
        "icon-xs": "h-6 w-6 pointer-coarse:h-10 pointer-coarse:w-10",
        "icon-sm": "h-7 w-7 pointer-coarse:h-10 pointer-coarse:w-10",
        icon: "h-9 w-9 pointer-coarse:h-10 pointer-coarse:w-10",
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
