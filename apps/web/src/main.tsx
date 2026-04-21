import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";

registerSW({ immediate: true });

const root = document.documentElement;
if (window.electronAPI) {
  root.dataset.runtime = "electron";
  const platformSource =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  root.dataset.platform = /mac|darwin/i.test(platformSource) ? "mac" : "windows";
} else {
  root.dataset.runtime = "pwa";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
