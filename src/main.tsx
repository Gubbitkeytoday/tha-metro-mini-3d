import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyDocumentLanguage } from "./i18n/documentLanguage";
import { useAppStore } from "./stores/useAppStore";
import "./index.css";

// Set `<html lang>`, the title and the canonical `?lang=` from the language
// the store resolved (URL > saved preference > browser), before first paint,
// then keep them in step. Outside React because they are document-level
// concerns no component owns.
applyDocumentLanguage(useAppStore.getState().language);
useAppStore.subscribe((state, prev) => {
  if (state.language !== prev.language) applyDocumentLanguage(state.language);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
