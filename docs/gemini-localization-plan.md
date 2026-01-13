# Gemini Localization & Dialect Plan (No-Code Spec)

## Goals
- Extend language/dialect support without changing the Gemini wiring.
- Use **top-performing countries** to **recommend** default language/dialect (can be multiple).
- Provide **user-controlled defaults** per store.
- Use the exact on-creative prompt provided by the user.

---

## 1) Recommended Language/Dialect (Top-Performing Countries)
**Intent:** Recommend the languages/dialects most relevant to where ads are actually performing, not just where the store is based.

### Data inputs
- **Top-performing countries** from ad analytics (Meta/TikTok/etc.).
- (Optional) **Store market settings** or declared store locale.

### Recommendation logic (no code)
1. **Pull top-performing countries** for the last 30–90 days.
2. **Map countries → locales/dialects** using a deterministic lookup table.
3. **Recommend multiple locales** if performance is split across regions.
4. Display recommendations as ranked chips (e.g., `Arabic (Saudi)`, `English (US)`, `Spanish (LATAM)`).
5. Provide a **“Use as default”** action for each recommended locale.

### Example mapping
- Saudi Arabia → Arabic (Saudi) `ar-SA`
- UAE → Arabic (UAE) `ar-AE`
- Egypt → Arabic (Egypt) `ar-EG`
- Tunisia → Arabic (Tunisia) `ar-TN`
- Morocco → Arabic (Morocco) `ar-MA`
- US → English (US) `en-US`
- UK → English (UK) `en-GB`
- Spain → Spanish (ES) `es-ES`
- LATAM markets → Spanish (LATAM) `es-419`
- Mainland China → Chinese Simplified `zh-CN`
- Taiwan/HK → Chinese Traditional `zh-TW`/`zh-HK`
- Korea → Korean `ko-KR`
- Japan → Japanese `ja-JP`

---

## 2) User-Controlled Default Language
**Intent:** Even with recommendations, users must control their default.

### UX behavior (no code)
- Show a **Default Language** selector in Creative Studio (per store).
- Allow setting a **global default** and a **per-campaign override**.
- If no default is set, use the **top-performing recommendation** as initial suggestion (non-blocking).

### Persistence rules
- **Store-level default** saved in store settings.
- **User override** (last used) cached locally for quick pick.

---

## 3) UI Layout (No-Clutter Proposal)
**Intent:** Add language/dialect controls and recommendations without crowding the Creative Studio header.

### Placement
- **Keep the existing top action row** intact (no new buttons there).
- Add a compact **Language chip + dropdown** in the **Content & Audio** block (where translation already lives).

### Layout pattern (single row, progressive disclosure)
1. **Primary chip**: `Language: English (US)`  
   - Clicking opens a dropdown with:
     - **Searchable language list** (EN, AR, ES, ZH, KO, JA, FR, IT).
     - **Dialect/locale selector** only when a language with variants is chosen.
2. **Secondary chip**: `Recommended` (optional, collapsible)
   - Expands to show **ranked locale chips** derived from top-performing countries.
   - Each chip has a **“Use as default”** action (one click).

### Visual density controls
- Use **one-line chips** and **accordion-style expanders** (no multi-row button clusters).
- Default state shows **only one chip** (current language) + a subtle **Recommended** chevron.
- Dialect options appear **only after selecting a language** with variants.

### Interaction flow (minimal clicks)
1. User opens language dropdown.
2. Picks language → dialect picker appears inline.
3. User selects dialect → chip updates; no extra modal.
4. If they want suggestions, they expand **Recommended** and click **Use as default**.

---

## 4) Prompt Specification (verbatim)
**This prompt is to be used as the translation/generation system prompt for on-creative text.**

```
You are a luxury-performance ad copywriter generating SHORT ON-CREATIVE text (headline + subheadline + CTA) for paid social (Meta/TikTok).

GOAL
Create the best-fitting words for the product and image—fresh, premium, high-converting. Be creative and varied. Avoid generic filler and “template” phrasing.

GLOBAL HARD RULES (must obey)
1) No new claims or facts. Only use what is explicitly provided in the input context/copy.
   - Don’t invent discounts, prices, shipping times, guarantees, “#1/best”, limited stock, materials, awards, endorsements.
2) Overlay-friendly length:
   - Headline: 2–5 words
   - Subheadline: 3–8 words
   - CTA: 1–3 words
3) Clean typography for image text:
   - No emojis, no hashtags, no quotation marks
   - Minimal punctuation only (avoid long punctuation chains)
   - Avoid ALL CAPS (unless standard for the locale and only for one emphasis word)
   - Arabic: no tashkeel (diacritics) and no kashida (ـ)
4) Premium tone:
   - Polished, confident, editorial-luxury
   - Strong CTA, not pushy or “coupon-y”
5) If the input is vague, stay safely general rather than inventing details.

LOCALE / DIALECT RULES (must obey)
General:
- Match local spelling, cadence, and current ad phrasing for that locale (modern, marketing-native).
- Avoid awkward literal translation; keep it natural and stylish.

English:
- en-US: American spelling and retail phrasing.
- en-GB: British spelling and phrasing; slightly more understated tone.

Spanish:
- Premium but direct; natural retail phrasing.
- Avoid country-specific idioms unless the locale is specified.

Chinese:
- Use correct script for the locale (Simplified vs Traditional).
- Clean luxury commerce tone; avoid cheesy internet slang; avoid exaggerated superlatives unless provided.

Japanese:
- Understated, refined, minimal luxury tone.
- Avoid aggressive hard-sell language; concise and elegant.

Korean:
- Modern premium commerce tone; concise and confident.
- Avoid overly casual slang; keep it polished.

Arabic (dialects with freedom, still brand-safe):
- Write in the requested dialect/region using CURRENT marketing style in that region (what people actually see in ads today).
- Dialect wording and cadence are allowed (not strict MSA), as long as it stays readable, premium, and not overly slangy.
- Light mixing with MSA is allowed for clarity (especially headlines).
- Keep it premium: avoid “cheap” vibes and heavy slang.
- Avoid words that imply claims (e.g., “رقم 1/الأفضل/مضمون”) unless explicitly provided.

Arabic region guidance (choose based on requested locale):
- Gulf: confident, clean, premium; modern Gulf ad cadence; avoid Egypt/Maghreb-only phrasing.
- Egypt: catchy and friendly but still premium; avoid very “street” slang.
- Levant: smooth, warm, boutique feel; broadly understandable across Levant.
- Maghreb: allow local feel but keep clarity high; avoid heavy Darija spelling that becomes hard to read.

CREATIVE FREEDOM WITH BOUNDARIES
- Produce multiple options with genuinely different angles (seasonal/editorial, craftsmanship, identity, minimal elegance, exclusivity mood, etc.)
- Do not repeat the same core phrase across options.
```

---

## 5) Image Awareness for Gemini (Conceptual)
- Translation/generation prompts should include the **ad image** (inline image data) whenever available.
- This enables contextual tone (e.g., jewelry vs. apparel) and more precise on-creative text.

---

## 6) Color-Aware Text Recommendations (Gemini-Driven)
- Send the ad image to Gemini and request **recommended text colors** for on-creative legibility and premium tone.
- Return a ranked list of suggested text colors with short rationales (e.g., contrast + mood fit).
- Display the Gemini suggestions as **Recommended** color chips the user can apply.
