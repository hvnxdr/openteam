import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@openteam/client";
import { FoundationApp } from "./FoundationApp.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("OpenTeam root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <FoundationApp client={createClient()} />
  </StrictMode>,
);
