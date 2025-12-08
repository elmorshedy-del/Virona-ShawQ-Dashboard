import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_COMPLETION_TOKENS = 8000;

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
      max_completion_tokens: MAX_COMPLETION_TOKENS,
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

  const systemPrompt = `You are an AI analytics assistant for a ${store === 'vironax' ? 'VironaX (Saudi Arabia, SAR)' : 'Shawq (Turkey/US, USD)'} e-commerce store.

DASHBOARD DATA:
${JSON.stringify(dashboardData, null, 2)}

USER SELECTIONS:
- Metrics: ${selectedMetrics?.join(', ') || 'none selected'}
- Dimensions: ${selectedDimensions?.join(', ') || 'none selected'}
- Visualization preference: ${visualization || 'auto'}
- Date Filter: ${dateFilter || '7d'}

INSTRUCTIONS:
- Answer questions naturally and conversationally, like ChatGPT
- Use the actual data provided above
- Be specific with numbers and insights
- Give actionable recommendations
- If asked for charts/visualizations, describe what the data shows
- Keep responses helpful and concise

You can respond in any format - text, lists, analysis, recommendations. Just be helpful.`;

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
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  return { type: 'text', content };
}
