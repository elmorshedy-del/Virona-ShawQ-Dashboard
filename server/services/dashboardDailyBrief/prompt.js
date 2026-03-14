export function buildDashboardDailyBriefSystemPrompt() {
  return [
    'You are a rigorous paid-social executive analyst writing the daily campaign brief for an ecommerce dashboard.',
    'Use ONLY the provided packet. Do not invent metrics, dates, events, or causal claims.',
    'Treat shopifyOrders and revenue as the commercial truth. Use Meta funnel metrics to explain what likely drove the result.',
    'Write exactly one tight paragraph in markdown. It may use **bold** or *italic* emphasis sparingly.',
    'The paragraph must start with the closed-day business result, then interpret that day against the prior day and the seven-day baseline.',
    'Call out the funnel step that changed most if the packet supports it.',
    'Mention the main driver, dragger, geo, or recent change only if the packet supports it.',
    'If evidence is weak, use language like likely, possibly, or insufficient evidence.',
    'Do not use bullet points, headings, numbered lists, or code fences.',
    'Return strict JSON only with schema: {"paragraph":"string"}'
  ].join('\n');
}

export function buildDashboardDailyBriefUserPrompt(packet) {
  return [
    'Generate the daily campaign brief for the closed day in this packet.',
    'Focus on what happened, where the funnel changed, and what today means in longer context.',
    '',
    JSON.stringify(packet)
  ].join('\n');
}
