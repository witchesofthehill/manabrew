const PRINT_READY_TIMEOUT_MS = 20_000;
const PENDING_CONTENT = "[data-design-system-pending], [data-card-render-state='loading']";

export async function prepareDesignSystemPrint(root: HTMLElement): Promise<void> {
  await document.fonts.ready;
  if (root.querySelector(PENDING_CONTENT)) {
    await new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (root.querySelector(PENDING_CONTENT)) return;
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve();
      });
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(
          new Error("Card examples are still loading. Wait for them to finish, then export again."),
        );
      }, PRINT_READY_TIMEOUT_MS);
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-design-system-pending", "data-card-render-state"],
      });
    });
  }
  await Promise.all(
    Array.from(root.querySelectorAll("img"), async (image) => {
      image.loading = "eager";
      try {
        await image.decode();
      } catch {
        throw new Error(
          `Could not load ${image.alt || "a reference image"}. Check your connection before exporting.`,
        );
      }
    }),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
