import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import QualityCockpit from "./QualityCockpit.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QualityCockpit />
  </StrictMode>
);
