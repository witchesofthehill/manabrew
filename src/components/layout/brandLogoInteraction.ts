export function bindBrandLogoInteraction(element: HTMLElement): () => void {
  const clear = () => {
    delete element.dataset.logoHover;
  };
  const enter = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      clear();
      return;
    }
    element.dataset.logoHover = "true";
  };
  const press = (event: PointerEvent) => {
    if (event.pointerType === "touch") clear();
  };

  element.addEventListener("pointerenter", enter);
  element.addEventListener("pointerleave", clear);
  element.addEventListener("pointercancel", clear);
  element.addEventListener("pointerdown", press);

  return () => {
    element.removeEventListener("pointerenter", enter);
    element.removeEventListener("pointerleave", clear);
    element.removeEventListener("pointercancel", clear);
    element.removeEventListener("pointerdown", press);
    clear();
  };
}
