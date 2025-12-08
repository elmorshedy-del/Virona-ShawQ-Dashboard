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
