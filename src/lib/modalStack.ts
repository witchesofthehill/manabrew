export const MODAL_OPEN_EVENT = "manabrew:modal-open";
export const MODAL_BASE_Z_INDEX = 10000;
export const MODAL_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalLayer {
  panel: HTMLElement;
  parent?: HTMLElement;
}
const layers: ModalLayer[] = [];
let outsideFocus: HTMLElement | null = null;

export function topModal(): HTMLElement | undefined {
  return layers.at(-1)?.panel;
}

function descendsFrom(layer: ModalLayer, ancestor: HTMLElement): boolean {
  let parent = layer.parent;
  while (parent) {
    if (parent === ancestor) return true;
    parent = layers.find((candidate) => candidate.panel === parent)?.parent;
  }
  return false;
}

function synchronize(): void {
  for (const [index, { panel }] of layers.entries()) {
    const backdrop = panel.parentElement!;
    backdrop.style.zIndex = String(MODAL_BASE_Z_INDEX + index * 2);
    backdrop.inert = panel !== topModal() || panel.dataset.closing === "true";
    panel.setAttribute("aria-modal", String(panel === topModal()));
  }
}

export function registerModal(
  panel: HTMLElement,
  parent?: HTMLElement,
  previousFocus: HTMLElement | null = null,
): () => void {
  if (!layers.length) outsideFocus = previousFocus;
  const children = layers.findIndex((layer) => descendsFrom(layer, panel));
  const parentIndex = layers.findIndex((layer) => layer.panel === parent);
  let index = children >= 0 ? children : layers.length;
  if (children < 0 && parent && parentIndex >= 0) {
    index = parentIndex + 1;
    while (index < layers.length && descendsFrom(layers[index], parent)) index++;
  }
  layers.splice(index, 0, { panel, parent });
  synchronize();
  window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
  return () => {
    const index = layers.findIndex((layer) => layer.panel === panel);
    if (index !== -1) layers.splice(index, 1);
    synchronize();
    if (!layers.length) {
      if (outsideFocus?.isConnected) outsideFocus.focus();
      outsideFocus = null;
    }
  };
}

export function modalFocusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE)).filter(
    (element) =>
      element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
}
