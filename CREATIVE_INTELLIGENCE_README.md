# Creative Intelligence Implementation

## Files Created/Modified

### New Files
1. `server/db/creativeIntelligenceMigration.js` - Database tables for scripts, settings, conversations
2. `server/routes/creativeIntelligence.js` - API routes for Gemini + Claude
3. `client/src/components/CreativeIntelligence.jsx` - New modern UI component

### Modified Files
1. `server/server.js` - Added route registration + migration call
2. `server/package.json` - Added @anthropic-ai/sdk and @google/generative-ai
3. `nixpacks.toml` - Added yt-dlp and ffmpeg

## Environment Variables Required

Add these to Railway:
```
GEMINI_API_KEY=your_gemini_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## How to Get API Keys

### Gemini
1. Go to https://aistudio.google.com/
2. Click "Get API Key"
3. Create new key

### Anthropic
1. Go to https://console.anthropic.com/
2. Create API key

## Installation Steps

1. Copy all files to your repo in their respective locations
2. Run `npm install` in the server folder
3. Add environment variables to Railway
4. Deploy

## Usage

1. Go to Creatives tab
2. Select a campaign and ad
3. Click "✨ Analyze with AI" to run Gemini video analysis
4. Once analyzed, chat with Claude about the ad

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/creative-intelligence/analyze-video` | POST | Analyze video with Gemini |
| `/api/creative-intelligence/script/:adId` | GET | Get script status |
| `/api/creative-intelligence/chat` | POST | Chat with Claude (streaming) |
| `/api/creative-intelligence/settings` | GET/PUT | Get/update AI settings |
| `/api/creative-intelligence/status` | GET | Check API keys + yt-dlp |

## Database Tables

- `creative_scripts` - Stores Gemini analysis per ad
- `ai_creative_settings` - User preferences per store
- `creative_conversations` - Chat history
- `creative_messages` - Individual messages

## Component Integration

Replace your current CreativePreview import with CreativeIntelligence:

```jsx
// In App.jsx or wherever you render the creatives tab
import CreativeIntelligence from './components/CreativeIntelligence';

// Then use:
<CreativeIntelligence store={currentStore} />
```
