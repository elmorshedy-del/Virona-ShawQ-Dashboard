import React, { useEffect, useMemo, useState } from "react";
import {
  fetchCreativeDNAProfile,
  refreshCreativeDNA,
  vectorizeCreativeDNAMark,
} from "./api";

const DEFAULT_TENANT_KEY = "default";
const DEFAULT_STORE_URL = "";
const LOCAL_STORAGE_TENANT_KEY = "creativeDnaTenantKey";
const LOCAL_STORAGE_STORE_URL = "creativeDnaStoreUrl";
const VECTOR_PRESET_OPTIONS = [
  { id: "color", label: "Color Logo" },
  { id: "monochrome", label: "Monochrome Mark" },
];

function deriveStoreKey(storeUrl) {
  try {
    const url = new URL(String(storeUrl || "").trim().includes("://") ? storeUrl : `https://${storeUrl}`);
    return (url.hostname || "").toLowerCase();
  } catch {
    return "";
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function svgToDataUrl(svg) {
  const encoded = typeof window !== "undefined" ? window.btoa(unescape(encodeURIComponent(svg))) : "";
  return `data:image/svg+xml;base64,${encoded}`;
}

function fmtDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString();
}

export default function CreativeDNATab() {
  const [tenantKey, setTenantKey] = useState(
    () => localStorage.getItem(LOCAL_STORAGE_TENANT_KEY) || DEFAULT_TENANT_KEY,
  );
  const [storeUrl, setStoreUrl] = useState(
    () => localStorage.getItem(LOCAL_STORAGE_STORE_URL) || DEFAULT_STORE_URL,
  );
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingVector, setLoadingVector] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [vectorError, setVectorError] = useState("");
  const [profile, setProfile] = useState(null);
  const [latestSvg, setLatestSvg] = useState("");
  const [markName, setMarkName] = useState("Brand Mark");
  const [vectorPreset, setVectorPreset] = useState("color");
  const [selectedFile, setSelectedFile] = useState(null);

  const storeKey = useMemo(() => deriveStoreKey(storeUrl), [storeUrl]);
  const canRefresh = Boolean(storeKey);
  const canVectorize = Boolean(profile && selectedFile && markName.trim());

  useEffect(() => {
    if (!storeKey) return;
    let cancelled = false;
    async function loadExisting() {
      try {
        const payload = await fetchCreativeDNAProfile({
          tenantKey: tenantKey.trim() || DEFAULT_TENANT_KEY,
          storeKey,
        });
        if (!cancelled) {
          setProfile(payload);
        }
      } catch (err) {
        // A 404 error is expected if the profile doesn't exist yet.
        // Other errors should be logged to aid debugging.
        if (!err.message?.includes("404")) {
          console.error("Failed to load Creative DNA profile:", err);
        }
      }
    }
    void loadExisting();
    return () => {
      cancelled = true;
    };
  }, [storeKey, tenantKey]);

  async function onRefresh(event) {
    event.preventDefault();
    if (!canRefresh) {
      setProfileError("A valid store URL is required");
      return;
    }
    setLoadingProfile(true);
    setProfileError("");
    try {
      const payload = await refreshCreativeDNA({
        tenantKey: tenantKey.trim() || DEFAULT_TENANT_KEY,
        storeKey,
        storeUrl,
      });
      localStorage.setItem(LOCAL_STORAGE_TENANT_KEY, tenantKey.trim() || DEFAULT_TENANT_KEY);
      localStorage.setItem(LOCAL_STORAGE_STORE_URL, storeUrl.trim());
      setProfile(payload);
    } catch (err) {
      setProfileError(err.message || "Failed to refresh Creative DNA");
    } finally {
      setLoadingProfile(false);
    }
  }

  async function onVectorize(event) {
    event.preventDefault();
    if (!profile || !selectedFile) return;
    setLoadingVector(true);
    setVectorError("");
    try {
      const payload = await vectorizeCreativeDNAMark({
        tenantKey: tenantKey.trim() || DEFAULT_TENANT_KEY,
        storeKey,
        storeUrl,
        name: markName.trim(),
        filename: selectedFile.name,
        imageBase64: await fileToBase64(selectedFile),
        preset: vectorPreset,
      });
      setProfile(payload.profile);
      setLatestSvg(payload.mark.svg);
    } catch (err) {
      const message = err.message || "Failed to convert artwork to SVG";
      setVectorError(
        message.includes("timed out")
          ? "SVG tracing took too long for this artwork. Use a cleaner mark image or retry with a simpler monochrome preset."
          : message,
      );
    } finally {
      setLoadingVector(false);
    }
  }

  const metrics = useMemo(() => {
    if (!profile) {
      return [
        { label: "Marks", value: 0 },
        { label: "Looks", value: 0 },
        { label: "Palette", value: 0 },
        { label: "Saved Work", value: 0 },
      ];
    }
    return [
      { label: "Marks", value: profile.marks?.length || 0 },
      { label: "Looks", value: profile.looks?.length || 0 },
      { label: "Palette", value: profile.palette?.length || 0 },
      { label: "Saved Work", value: profile.saved_works?.length || 0 },
    ];
  }, [profile]);

  const activeSvg = latestSvg || profile?.marks?.[0]?.svg || "";
  const activeSvgUrl = activeSvg ? svgToDataUrl(activeSvg) : "";

  return (
    <>
      <section className="panel hero">
        <div>
          <p className="eyebrow">Creative DNA</p>
          <h1>Brand Memory for Product Creative</h1>
          <p>
            Save the brand system behind your strongest ecommerce assets: looks, export recipes,
            vector marks, and the visual direction you want the rest of the stack to follow.
          </p>
        </div>
        <form onSubmit={onRefresh} className="form">
          <input
            value={tenantKey}
            onChange={(event) => setTenantKey(event.target.value)}
            placeholder="Tenant key"
          />
          <input
            value={storeUrl}
            onChange={(event) => setStoreUrl(event.target.value)}
            placeholder="https://store.com"
            required
          />
          <button type="submit" disabled={loadingProfile || !canRefresh}>
            {loadingProfile ? "Refreshing..." : "Refresh DNA"}
          </button>
        </form>
        {profileError ? <p className="error">{profileError}</p> : null}
      </section>

      <section className="panel metrics">
        {metrics.map((item) => (
          <article key={item.label}>
            <h2>{item.value}</h2>
            <p>{item.label}</p>
          </article>
        ))}
      </section>

      <section className="split split-hero">
        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Brand Core</p>
              <h3>{profile?.brand_name || "Refresh a store to build Creative DNA"}</h3>
            </div>
            {profile?.updated_at ? <span className="chip good">Updated {fmtDate(profile.updated_at)}</span> : null}
          </div>
          <p className="body-copy">{profile?.summary || "Creative DNA starts by reading the store, inferring visual direction, and saving reusable commerce defaults."}</p>
          <div className="chips">
            {(profile?.tone_keywords || []).map((token) => (
              <span key={token} className="chip">
                {token}
              </span>
            ))}
          </div>
          <div className="stack compact">
            <div className="item">
              <div>
                <strong>Photography Direction</strong>
                <p>{profile?.photography_direction || "No direction loaded yet."}</p>
              </div>
            </div>
            <div className="item">
              <div>
                <strong>Store Positioning</strong>
                <p>{profile?.source_profile?.positioning || "Refresh the profile to ingest your public storefront signals."}</p>
              </div>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Convert to SVG</p>
              <h3>Production Mark Prep</h3>
            </div>
          </div>
          <form onSubmit={onVectorize} className="stack">
            <input
              value={markName}
              onChange={(event) => setMarkName(event.target.value)}
              placeholder="Mark name"
            />
            <div className="form compact-form">
              <select value={vectorPreset} onChange={(event) => setVectorPreset(event.target.value)}>
                {VECTOR_PRESET_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
              />
            </div>
            <button type="submit" disabled={loadingVector || !canVectorize}>
              {loadingVector ? "Vectorizing..." : "Convert to SVG"}
            </button>
          </form>
          <p className="body-copy muted">
            Best for logos, badges, patches, and simple sketch marks that need clean scalable SVG
            output.
          </p>
          {selectedFile ? (
            <p className="body-copy muted">
              Selected artwork: <strong>{selectedFile.name}</strong>
            </p>
          ) : null}
          {vectorError ? <p className="error compact-error">{vectorError}</p> : null}
          {activeSvgUrl ? (
            <div className="svg-preview-shell">
              <img src={activeSvgUrl} alt="Vector preview" className="svg-preview" />
              <a className="button-link" href={activeSvgUrl} download={`${markName || "creative-dna-mark"}.svg`}>
                Download SVG
              </a>
            </div>
          ) : null}
        </article>
      </section>

      <section className="split">
        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Looks</p>
              <h3>Reusable Brand Directions</h3>
            </div>
          </div>
          <div className="stack">
            {(profile?.looks || []).map((look) => (
              <div key={look.id} className="item">
                <div>
                  <strong>{look.name}</strong>
                  <p>{look.description}</p>
                  <p className="muted">{look.background_prompt}</p>
                </div>
                <span className="chip">{look.shadow_style}</span>
              </div>
            ))}
            {!profile?.looks?.length ? <p>No looks yet.</p> : null}
          </div>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Palette</p>
              <h3>Suggested Brand Colors</h3>
            </div>
          </div>
          <div className="palette-grid">
            {(profile?.palette || []).map((color) => (
              <div key={color.id} className="palette-card">
                <span className="palette-swatch" style={{ background: color.hex }} />
                <strong>{color.name}</strong>
                <p>{color.hex}</p>
                <span className="chip">{color.role}</span>
              </div>
            ))}
            {!profile?.palette?.length ? <p>No palette yet.</p> : null}
          </div>
        </article>
      </section>

      <section className="split">
        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Marks</p>
              <h3>Saved Brand Assets</h3>
            </div>
          </div>
          <div className="stack">
            {(profile?.marks || []).map((mark) => {
              const markUrl = svgToDataUrl(mark.svg);
              return (
                <div key={mark.id} className="item asset-item">
                  <img src={markUrl} alt={mark.name} className="mark-thumb" />
                  <div>
                    <strong>{mark.name}</strong>
                    <p>{mark.source_name || "Generated in Creative DNA"}</p>
                    <p className="muted">{fmtDate(mark.created_at)}</p>
                  </div>
                  <a className="button-link" href={markUrl} download={`${mark.name || "mark"}.svg`}>
                    SVG
                  </a>
                </div>
              );
            })}
            {!profile?.marks?.length ? <p>No marks saved yet.</p> : null}
          </div>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Saved Work</p>
              <h3>Previous Creative Decisions</h3>
            </div>
          </div>
          <div className="stack">
            {(profile?.saved_works || []).map((item) => (
              <div key={item.id} className="item">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description || item.work_type}</p>
                </div>
                <span className="chip">{fmtDate(item.created_at)}</span>
              </div>
            ))}
            {!profile?.saved_works?.length ? <p>No saved work yet.</p> : null}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Export DNA</p>
            <h3>Default Commerce Outputs</h3>
          </div>
        </div>
        <div className="stack">
          {(profile?.export_presets || []).map((preset) => (
            <div key={preset.id} className="item">
              <div>
                <strong>{preset.name}</strong>
                <p>{preset.use_case}</p>
              </div>
              <span>{preset.width_px} x {preset.height_px}</span>
            </div>
          ))}
          {!profile?.export_presets?.length ? <p>No export presets yet.</p> : null}
        </div>
      </section>
    </>
  );
}
