# Output Shapes Feature

## Overview

Added customizable output shapes to the Testimonial Extractor, allowing users to render testimonials in 4 different visual styles beyond the standard chat bubble.

---

## Output Shapes

### 1. **Chat Bubble** (Default)
- Classic rounded rectangle chat bubble
- Customizable border radius (0-50px)
- Supports all bubble styles (solid, shadows, outline)
- Respects left/right positioning

**Best for:** Traditional chat screenshot transformations, social proof

### 2. **Quote Card**
- Centered text with decorative quotation marks (« »)
- Larger font size (+4px from base)
- Wider max-width (600px vs 500px)
- Always centered (ignores left/right positioning)
- Extra padding (40px vs 20px)

**Best for:** Featured testimonials, Instagram posts, presentations

### 3. **Card**
- Clean rectangle with subtle 1px border
- Defined border: `1px solid rgba(0, 0, 0, 0.15)`
- Professional, minimalist look
- Standard padding (24px)

**Best for:** Website testimonials, LinkedIn posts, formal presentations

### 4. **Minimal**
- No container or background
- Just text directly on the canvas background
- Border radius slider is disabled (N/A)
- Bubble styles (shadows, outlines) are skipped
- Lightest visual weight

**Best for:** Transparent overlays, subtle text on images, raw text exports

---

## UI Implementation

### Frontend (TestimonialExtractor.jsx)

**Added Constants:**
```javascript
const OUTPUT_SHAPES = [
  { value: 'bubble', label: 'Chat Bubble', description: 'Rounded rectangle chat bubble' },
  { value: 'quote_card', label: 'Quote Card', description: 'Large quotation marks with centered text' },
  { value: 'card', label: 'Card', description: 'Rectangle with subtle border' },
  { value: 'minimal', label: 'Minimal', description: 'Just text on background' }
];
```

**Added State:**
```javascript
const [outputShape, setOutputShape] = useState('bubble');
const [borderRadius, setBorderRadius] = useState(20);
```

**UI Controls (in Advanced Options accordion):**

1. **Output Shape Selection** - 2x2 grid of buttons with shape name + description
2. **Border Radius Slider** - 0-50px range, disabled when shape is "minimal"

**API Payload:**
```javascript
{
  outputShape: 'quote_card',
  borderRadius: 30,
  // ... other options
}
```

---

## Backend Implementation

### testimonialRendererService.js

**Updated Function Signature:**
```javascript
function generateHTML(messages, config) {
  const {
    // ... existing params
    outputShape = 'bubble',
    borderRadius = 20,
    // ... more params
  } = config;
}
```

**Shape-Specific CSS Generation:**

```javascript
if (outputShape === 'minimal') {
  // No background, border, or padding
  bubbleCSS = `
    color: ${textColor};
    font-size: ${fontSize}px;
    // ... basic text styling only
  `;
} else if (outputShape === 'quote_card') {
  // Centered with larger font and padding
  bubbleCSS = `
    background: ${bubbleColor};
    padding: 40px 30px;
    border-radius: ${borderRadius}px;
    font-size: ${fontSize + 4}px;
    text-align: center;
    // ...
  `;
} else if (outputShape === 'card') {
  // Rectangle with border
  bubbleCSS = `
    background: ${bubbleColor};
    border-radius: ${borderRadius}px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    // ...
  `;
} else {
  // Default bubble
  bubbleCSS = `
    border-radius: ${borderRadius}px;
    // ...
  `;
}
```

**Quote Card Special Handling:**

```javascript
const formatMessage = (text) => {
  if (outputShape === 'quote_card') {
    return `<span style="...">«</span> ${escapeHtml(text)} <span style="...">»</span>`;
  }
  return escapeHtml(text);
};
```

**Alignment Override:**
```javascript
// Center quote cards regardless of message side
const actualAlignment = outputShape === 'quote_card' ? 'center' : alignment;
```

### testimonialExtractor.js (Routes)

**Updated Request Destructuring:**
```javascript
const {
  messages,
  preset,
  layout,
  collageColumns,
  outputShape,        // NEW
  borderRadius,       // NEW
  backgroundType,
  // ... rest
} = req.body;
```

**Added to Options:**
```javascript
if (outputShape) options.outputShape = outputShape;
if (borderRadius !== undefined) options.borderRadius = parseInt(borderRadius);
```

---

## Behavior Matrix

| Shape | Border Radius | Shadows/Outline | Alignment | Quotation Marks | Max Width |
|-------|---------------|-----------------|-----------|-----------------|-----------|
| **Bubble** | ✅ 0-50px | ✅ All styles | Left/Right | ❌ | 500px |
| **Quote Card** | ✅ 0-50px | ✅ All styles | Center only | ✅ « » | 600px |
| **Card** | ✅ 0-50px | ✅ + Border | Left/Right | ❌ | 500px |
| **Minimal** | ❌ N/A | ❌ None | Left/Right | ❌ | 500px |

---

## Visual Examples

### Bubble (Default)
```
┌─────────────────────────────┐
│  "This is amazing! 🔥"      │
└─────────────────────────────┘
```

### Quote Card
```
        ┌─────────────────────────────────┐
        │                                 │
        │  « This is amazing! 🔥 »        │
        │                                 │
        └─────────────────────────────────┘
```

### Card
```
╔═════════════════════════════╗
║  This is amazing! 🔥        ║
╚═════════════════════════════╝
```

### Minimal
```
This is amazing! 🔥
(no container)
```

---

## User Experience Flow

1. User extracts messages from screenshots
2. Opens **Advanced Options**
3. Selects **Output Shape** from 4 options
4. Adjusts **Border Radius** slider (auto-disabled for Minimal)
5. Clicks **Generate Testimonial**
6. Preview shows styled testimonial with chosen shape
7. Downloads as PNG

---

## Technical Details

### CSS Rendering (Puppeteer)
- All shapes rendered via CSS in HTML template
- Quotation marks: `<span>« »</span>` with larger font-size (1.5em)
- Border radius: Direct CSS `border-radius: ${borderRadius}px`
- Minimal: No wrapper div, text nodes only

### Compatibility
- Works with all presets (Instagram, Twitter, LinkedIn, etc.)
- Compatible with all layouts (Stacked, Collage)
- Works with transparent backgrounds
- Compatible with all background types (solid, gradient, transparent, custom)

### Performance
- No performance impact (CSS-only changes)
- Same Puppeteer rendering time (~2-5 seconds)

---

## API Examples

### Generate Quote Card with 30px Border Radius

```bash
POST /api/testimonials/generate
Content-Type: application/json

{
  "messages": [
    { "text": "Best product ever!", "side": "left", "order": 1 }
  ],
  "preset": "instagram_post",
  "outputShape": "quote_card",
  "borderRadius": 30,
  "bubbleColor": "#ffffff",
  "textColor": "#000000",
  "fontSize": 28
}
```

### Generate Minimal (No Container)

```bash
POST /api/testimonials/generate
Content-Type: application/json

{
  "messages": [
    { "text": "Amazing quality! Highly recommend.", "side": "left", "order": 1 }
  ],
  "preset": "raw_bubbles",
  "outputShape": "minimal",
  "backgroundType": "transparent",
  "textColor": "#ffffff",
  "fontSize": 32
}
```

### Generate Card with 0px Border Radius (Sharp Corners)

```bash
POST /api/testimonials/generate
Content-Type: application/json

{
  "messages": [
    { "text": "Professional service.", "side": "left", "order": 1 }
  ],
  "preset": "linkedin",
  "outputShape": "card",
  "borderRadius": 0,
  "bubbleStyle": "solid"
}
```

---

## Testing Checklist

- [x] All 4 shapes render correctly
- [x] Border radius slider works (0-50px)
- [x] Border radius disabled for minimal shape
- [x] Quote card shows quotation marks (« »)
- [x] Quote card centers text
- [x] Card shape shows subtle border
- [x] Minimal shape has no container
- [x] Shadows/outlines apply correctly (except minimal)
- [x] Works with all presets
- [x] Works with both layouts (stacked, collage)
- [x] Works with transparent backgrounds
- [x] API accepts and processes parameters
- [x] Frontend syntax valid
- [x] Backend syntax valid

---

## Files Modified

### Frontend
- `client/src/components/TestimonialExtractor.jsx`
  - Added OUTPUT_SHAPES constant
  - Added outputShape and borderRadius state
  - Added UI controls in Advanced Options
  - Updated API payload

### Backend
- `server/services/testimonialRendererService.js`
  - Updated generateHTML function signature
  - Added shape-specific CSS generation
  - Added formatMessage helper for quote marks
  - Added alignment override for quote cards

- `server/routes/testimonialExtractor.js`
  - Added outputShape and borderRadius to request body
  - Added parameters to options object passed to renderer

---

## Future Enhancements

- [ ] Custom quotation mark styles (" ", « », „ ", ‹ ›)
- [ ] Author attribution line for quote cards
- [ ] Gradient borders for card shape
- [ ] Glassmorphism/frosted glass effect
- [ ] Neon glow effect for minimal shape
- [ ] Shape presets (e.g., "Magazine Quote", "Corporate Card")

---

## Troubleshooting

### Border radius not changing
- **Cause:** Using "minimal" shape (radius is N/A)
- **Fix:** Switch to bubble, quote_card, or card

### Quote marks not showing
- **Cause:** Not using "quote_card" shape
- **Fix:** Select "Quote Card" from Output Shape options

### Text not centered
- **Cause:** Using bubble or card shape (respects left/right)
- **Fix:** Use "quote_card" for center alignment

---

## Summary

The Output Shapes feature gives users **4 distinct visual styles** for testimonials:
1. **Bubble** - Classic chat look
2. **Quote Card** - Featured testimonial with quotes
3. **Card** - Professional bordered rectangle
4. **Minimal** - Clean text-only

With **customizable border radius (0-50px)** and full compatibility with existing features (presets, layouts, backgrounds, styles), users can now create testimonials that match any brand aesthetic or use case.
