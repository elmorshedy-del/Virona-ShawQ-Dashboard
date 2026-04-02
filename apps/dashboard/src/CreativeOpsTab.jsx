import React, { useState } from "react";
import CreativeDatasetHubTab from "./CreativeDatasetHubTab";
import CreativeLabelWorkbenchTab from "./CreativeLabelWorkbenchTab";
import CreativeUsaRollupTab from "./CreativeUsaRollupTab";

const MODES = [
  {
    id: "workbench",
    label: "Workbench",
    eyebrow: "Operator Surface",
    title: "Inspect and run labels",
    description:
      "Debug one creative at a time or batch-label a queue without leaving the same workspace.",
  },
  {
    id: "library",
    label: "Library",
    eyebrow: "Merged Creative View",
    title: "Review canonical creatives",
    description:
      "Browse blended USA performance, usage memory, and stored label readiness on one merged creative table.",
  },
  {
    id: "dataset-hub",
    label: "Dataset Hub",
    eyebrow: "ML Builder",
    title: "Create ML-ready datasets",
    description:
      "Choose the row shape, target, feature groups, and output format before building a training table artifact.",
  },
];

export default function CreativeOpsTab({ tenantKey, storeKey }) {
  const [mode, setMode] = useState("workbench");
  const active = MODES.find((item) => item.id === mode) || MODES[0];

  return (
    <>
      <section className="panel tabs-panel">
        <div className="tabs">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={mode === item.id ? "tab active" : "tab"}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ops-subtitle">
          <p className="eyebrow">{active.eyebrow}</p>
          <p className="body-copy">
            {active.title}. {active.description}
          </p>
        </div>
      </section>

      {mode === "workbench" ? <CreativeLabelWorkbenchTab tenantKey={tenantKey} storeKey={storeKey} /> : null}
      {mode === "library" ? <CreativeUsaRollupTab tenantKey={tenantKey} storeKey={storeKey} /> : null}
      {mode === "dataset-hub" ? <CreativeDatasetHubTab tenantKey={tenantKey} storeKey={storeKey} /> : null}
    </>
  );
}
