import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PreviewProvider } from "./components/AttachmentPreview";
import { AssistantProvider } from "./lib/assistant";
import { LocaleProvider } from "./lib/i18n";
import { AppearanceProvider } from "./lib/theme";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppearanceProvider>
    <LocaleProvider>
      <AssistantProvider>
        <PreviewProvider>
          <App />
        </PreviewProvider>
      </AssistantProvider>
    </LocaleProvider>
    </AppearanceProvider>
  </React.StrictMode>,
);
