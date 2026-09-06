import { useEffect, useState } from "react";

type Preview = { id: string; image?: string; name: string };

export function CardPreview({ card }: { card?: Preview }) {
  const [shown, setShown] = useState<Preview>();
  const id = card?.id,
    image = card?.image,
    name = card?.name;
  useEffect(() => {
    let cancelled = false;
    let pending: HTMLImageElement | undefined;
    const timer = window.setTimeout(
      () => {
        if (!id || !name || !image) {
          setShown(undefined);
          return;
        }
        pending = new Image();
        pending.onload = () => {
          if (!cancelled) setShown({ id, image, name });
        };
        pending.onerror = () => {
          if (!cancelled) setShown(undefined);
        };
        pending.src = image;
      },
      id ? 90 : 180,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (pending) {
        pending.onload = null;
        pending.onerror = null;
      }
    };
  }, [id, image, name]);
  if (!shown?.image) return null;
  return (
    <aside className="arena-preview" data-visible={Boolean(card)} aria-hidden="true">
      <img
        key={shown.id}
        src={shown.image}
        alt={shown.name}
        onLoad={(event) => {
          event.currentTarget.dataset.loaded = "true";
        }}
      />
    </aside>
  );
}
