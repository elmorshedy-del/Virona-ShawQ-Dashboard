import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_OUTPUT_TOKENS = 8000;

export async function askAnalyticsQuestion(question, dashboardData, store, reasoningEffort = 'medium') {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const systemContext = `You are an expert e-commerce analytics assistant for ${store === 'vironax' ? 'VironaX (Saudi Arabia, SAR currency)' : 'Shawq (Turkey/US, USD currency)'}.

DASHBOARD DATA:
${JSON.stringify(dashboardData, null, 2)}

INSTRUCTIONS:
- Analyze the data and give specific, actionable insights
- Use actual numbers from the data
- Be concise but thorough
- Give recommendations when relevant
- Format responses clearly`;

  const fullInput = `${systemContext}\n\nUser Question: ${question}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5.1',
      input: fullInput,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: MAX_OUTPUT_TOKENS
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }

  const data = await response.json();
  return data.output_text;
}

export async function exploreData(query, dashboardData, store, reasoningEffort = 'medium', options = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const { selectedMetrics, selectedDimensions, visualization, dateFilter } = options;

  const systemContext = `You are an AI analytics assistant for ${store === 'vironax' ? 'VironaX (Saudi Arabia, SAR currency)' : 'Shawq (Turkey/US, USD currency)'}.

DASHBOARD DATA:
${JSON.stringify(dashboardData, null, 2)}

USER SELECTIONS:
- Metrics: ${selectedMetrics?.join(', ') || 'none'}
- Dimensions: ${selectedDimensions?.join(', ') || 'none'}
- Visualization preference: ${visualization || 'auto'}
- Date Filter: ${dateFilter || '7d'}

INSTRUCTIONS:
- Answer questions naturally and conversationally
- Use ACTUAL numbers from the dashboard data above
- Be specific with metrics, percentages, and trends
- Give actionable recommendations
- If comparing campaigns, rank them clearly
- Highlight what's working and what needs attention
- Keep responses helpful and insightful`;

  const userQuery = query || `Show me ${selectedMetrics?.join(' and ') || 'key metrics'}${selectedDimensions?.length ? ' by ' + selectedDimensions.join(', ') : ''}`;
  const fullInput = `${systemContext}\n\nUser Question: ${userQuery}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5.1',
      input: fullInput,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: MAX_OUTPUT_TOKENS
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }

  const data = await response.json();

  return {
    type: 'text',
    content: data.output_text
  };
}
