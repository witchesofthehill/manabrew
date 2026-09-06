import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArenaPlayground } from "@/three/ArenaPlayground";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ArenaPlayground />
  </StrictMode>,
);
