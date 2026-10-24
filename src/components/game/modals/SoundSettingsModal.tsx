import { SoundControls } from "@/components/SoundControls";
import { Modal } from "./Modal";

export function SoundSettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">Sound settings</h2>
        <p className="text-xs text-muted-foreground">
          Mute sounds or adjust the app-wide volume. Changes apply immediately.
        </p>
      </Modal.Header>
      <Modal.Body>
        <SoundControls />
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close onClose={onClose} variant="ghost">
          Done
        </Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}
