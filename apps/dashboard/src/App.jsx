import React, { useMemo, useState } from "react";
import CreativeDNATab from "./CreativeDNATab";
import ConversionBlackboxTab from "./ConversionBlackboxTab";
import KeywordIntelTab from "./KeywordIntelTab";

const TABS = [
  { id: "keyword", label: "Keyword Intelligence" },
  { id: "dna", label: "Creative DNA" },
  { id: "blackbox", label: "Conversion Blackbox" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("keyword");

  const renderTab = useMemo(() => {
    if (activeTab === "dna") {
      return <CreativeDNATab />;
    }
    if (activeTab === "blackbox") {
      return <ConversionBlackboxTab />;
    }
    return <KeywordIntelTab />;
  }, [activeTab]);

  return (
    <main className="page">
      <section className="panel tabs-panel">
        <div className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={activeTab === tab.id ? "tab active" : "tab"}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>
      {renderTab}
    </main>
  );
}
