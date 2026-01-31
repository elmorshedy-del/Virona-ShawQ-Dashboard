# Custom Facebook Ads Library Scraper

Stealth Puppeteer scraper for Facebook Ad Library with filtering.

## Deploy to Apify

### Option 1: Apify CLI (Recommended)

```bash
# Install Apify CLI
npm install -g apify-cli

# Login to Apify
apify login

# Deploy actor
cd apify-actor
apify push
```

### Option 2: Web Upload

1. Go to https://console.apify.com/actors
2. Click "Create new"
3. Choose "Develop your own Actor"
4. Upload these files or link to GitHub

## Usage

After deployment, call the actor:

```javascript
const result = await fetch(
  `https://api.apify.com/v2/acts/YOUR_USERNAME~facebook-ads-scraper-custom/runs?token=${APIFY_TOKEN}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      searchQuery: 'Nike',
      country: 'US',
      limit: 5,
      filterResults: true
    })
  }
);
```

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| searchQuery | string | required | Brand/keyword to search |
| country | string | "US" | Country code |
| limit | integer | 10 | Max results |
| filterResults | boolean | true | Only return matching ads |
