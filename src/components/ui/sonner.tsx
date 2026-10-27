"use client";
import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
type ToasterProps = React.ComponentProps<typeof Sonner>;
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      offset={{
        top: "calc(var(--safe-area-inset-top) + 4.25rem)",
        right: "calc(var(--safe-area-inset-right) + 0.75rem)",
        bottom: "calc(var(--safe-area-inset-bottom) + 24px)",
        left: "calc(var(--safe-area-inset-left) + 24px)",
      }}
      mobileOffset={{
        top: "calc(var(--safe-area-inset-top) + 16px)",
        right: "calc(var(--safe-area-inset-right) + 16px)",
        bottom: "calc(var(--safe-area-inset-bottom) + 16px)",
        left: "calc(var(--safe-area-inset-left) + 16px)",
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          title: "group-[.toast]:text-ui-label",
          description: "group-[.toast]:text-ui-meta group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:min-h-8 group-[.toast]:text-ui-label group-[.toast]:touch:min-h-11 group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:min-h-8 group-[.toast]:text-ui-label group-[.toast]:touch:min-h-11 group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};
export { Toaster };
