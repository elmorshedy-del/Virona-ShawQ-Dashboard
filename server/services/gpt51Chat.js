import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function askGPT51(userText, effort = 'high') {
  const allowed = new Set(['none', 'low', 'medium', 'high']);
  const safeEffort = allowed.has(effort) ? effort : 'high';

  const resp = await client.responses.create({
    model: 'gpt-5.1-chat-latest',
    reasoning: { effort: safeEffort },
    input: [{ role: 'user', content: userText }],
    max_output_tokens: 900
  });

  return resp.output_text;
}
