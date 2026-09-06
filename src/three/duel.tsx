import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ForgeDuel } from "@/three/ForgeDuel";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ForgeDuel />
  </StrictMode>,
);
