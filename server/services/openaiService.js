import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function askAnalyticsQuestion(question, dashboardData, store, model = 'gpt-5.1') {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const systemPrompt = `You are an expert e-commerce analytics assistant for a jewelry business. You have access to the user's real dashboard data. Answer questions directly based on this data.

STORE: ${store === 'vironax' ? 'VironaX (Saudi Arabia, SAR currency)' : 'Shawq (Turkey/US, USD currency)'}

DASHBOARD DATA:
${JSON.stringify(dashboardData, null, 2)}

Be specific with numbers. Give actionable recommendations. Be concise.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ],
      max_completion_tokens: 1000,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export async function exploreData(query, dashboardData, store, model, options = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const { selectedMetrics, selectedDimensions, visualization, dateFilter } = options;

  const systemPrompt = `You are an AI analytics assistant that analyzes e-commerce data and returns structured results.

STORE: ${store === 'vironax' ? 'VironaX (Saudi Arabia, SAR currency)' : 'Shawq (Turkey/US, USD currency)'}

DASHBOARD DATA:
${JSON.stringify(dashboardData, null, 2)}

USER SELECTIONS:
- Metrics: ${selectedMetrics?.join(', ') || 'none'}
- Dimensions: ${selectedDimensions?.join(', ') || 'none'}
- Visualization: ${visualization || 'auto'}
- Date Filter: ${dateFilter || '7d'}

YOUR RESPONSE MUST BE VALID JSON with this structure:
{
  "type": "metric" | "chart" | "text",
  "description": "Brief description of what we're showing",
  "generatedQuery": "FROM data\\n  SHOW metric\\n  DURING period\\n  VISUALIZE type",

  // For type: "metric"
  "value": "31",
  "label": "Orders",
  "change": 12.5,

  // For type: "chart"
  "data": [{"name": "Mon", "value": 10}, {"name": "Tue", "value": 15}],
  "chartType": "bar" | "line" | "pie",

  // For type: "text"
  "content": "Your detailed analysis here..."
}

RULES:
1. For single number questions (how many, what is), use type: "metric"
2. For trends, comparisons, breakdowns, use type: "chart" with actual data
3. For complex analysis, use type: "text"
4. Always include generatedQuery in Shopify-style format
5. Use actual numbers from the dashboard data provided
6. ONLY return valid JSON, no other text`;

  const userQuery = query || `Show me ${selectedMetrics?.join(' and ') || 'orders'}${selectedDimensions?.length ? ' by ' + selectedDimensions.join(', ') : ''}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: model || 'gpt-5.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuery }
      ],
      max_completion_tokens: 2000,
      temperature: 0.3,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  try {
    return JSON.parse(content);
  } catch (e) {
    return { type: 'text', content, generatedQuery: 'FROM data\n  SHOW response\n  VISUALIZE text' };
  }
}
