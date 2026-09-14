import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignInFlow } from "@/components/auth/SignInFlow";
import { useSignInDialog } from "@/stores/useSignInDialogStore";

export function SignInDialog() {
  const open = useSignInDialog((s) => s.open);
  const prefill = useSignInDialog((s) => s.prefill);
  const hide = useSignInDialog((s) => s.hide);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : hide())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Sign in to Manabrew</DialogTitle>
          <DialogDescription className="sr-only">
            Your account syncs your decks and keeps publications yours on any device.
          </DialogDescription>
        </DialogHeader>
        {open && <SignInFlow prefill={prefill} onComplete={hide} />}
      </DialogContent>
    </Dialog>
  );
}
