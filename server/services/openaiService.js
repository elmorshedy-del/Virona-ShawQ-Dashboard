import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_OUTPUT_TOKENS = 20000;

// Analyze mode - uses GPT-5 mini for fast responses
export async function analyzeQuestion(question, dashboardData, store) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const systemContext = `You are a helpful e-commerce analytics assistant for ${store === 'vironax' ? 'VironaX (Saudi Arabia, SAR currency)' : 'Shawq (Turkey/US, USD currency)'}.

DASHBOARD DATA:
${JSON.stringify(dashboardData, null, 2)}

INSTRUCTIONS:
- Give quick, concise answers
- Use actual numbers from the data
- Be direct and helpful
- Keep responses short but informative`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemContext },
        { role: 'user', content: question }
      ],
      max_tokens: 2000,
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

// Decide mode - uses GPT-5.1 with reasoning effort
export async function decideQuestion(question, dashboardData, store, reasoningEffort = 'medium') {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const effortMap = {
    'fast': 'low',
    'balanced': 'medium',
    'deep': 'high'
  };
  const effort = effortMap[reasoningEffort] || reasoningEffort;

  const systemContext = `You are an expert e-commerce strategist and campaign analyst for ${store === 'vironax' ? 'VironaX (Saudi Arabia, SAR currency)' : 'Shawq (Turkey/US, USD currency)'}.

DASHBOARD DATA:
${JSON.stringify(dashboardData, null, 2)}

INSTRUCTIONS:
- Provide strategic, actionable recommendations
- Analyze the data deeply and find insights
- Be specific with numbers and percentages
- Structure your response clearly with sections
- Prioritize recommendations by impact
- Include specific action items
- Explain your reasoning`;

  const fullInput = `${systemContext}\n\nUser Question: ${question}`;

  // Try the new Responses API first
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5.1',
        input: fullInput,
        reasoning: { effort: effort },
        max_output_tokens: MAX_OUTPUT_TOKENS
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.output_text;
    }
  } catch (e) {
    console.log('[AI] Responses API not available, falling back to Chat Completions');
  }

  // Fallback to Chat Completions API with GPT-4o
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemContext },
        { role: 'user', content: question }
      ],
      max_tokens: 4096,
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

// Legacy function for compatibility
export async function askAnalyticsQuestion(question, dashboardData, store, reasoningEffort) {
  return decideQuestion(question, dashboardData, store, reasoningEffort);
}

export async function exploreData(query, dashboardData, store, mode, reasoningEffort, options = {}) {
  if (mode === 'analyze') {
    const content = await analyzeQuestion(query, dashboardData, store);
    return { type: 'text', content };
  } else {
    const content = await decideQuestion(query, dashboardData, store, reasoningEffort);
    return { type: 'text', content };
  }
}
