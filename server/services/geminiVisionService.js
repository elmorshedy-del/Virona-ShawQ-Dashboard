// server/services/geminiVisionService.js
// Handles all Gemini API calls for Creative Studio

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

// ============================================================================
// STYLE EXTRACTION - Extract design system from reference image
// ============================================================================
async function extractStyle(imageBase64) {
  const prompt = `Analyze this ad image and extract the design system. Return ONLY valid JSON with no markdown:
{
  "fontFamily": "closest Google Font name (e.g., Playfair Display, Montserrat, Inter)",
  "fontCategory": "serif|sans-serif|display",
  "fontWeight": "300|400|500|600|700",
  "colors": {
    "primary": "#hex",
    "secondary": "#hex", 
    "background": "#hex",
    "text": "#hex",
    "accent": "#hex"
  },
  "textStyle": "uppercase|lowercase|capitalize|none",
  "letterSpacing": "tight|normal|wide|extra-wide",
  "layout": "centered|split|framed|overlay",
  "aesthetic": "minimalist|bold|luxury|playful|editorial",
  "overlayOpacity": 0-100,
  "hasGradient": true|false,
  "borderStyle": "none|thin|thick|rounded"
}`;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
    ]);
    
    const text = result.response.text();
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (error) {
    console.error('Style extraction error:', error);
    throw new Error('Failed to extract style from image');
  }
}

// ============================================================================
// COMPETITOR AD ANALYSIS - Deep breakdown of competitor creative
// ============================================================================
async function analyzeCompetitorAd(imageBase64) {
  const prompt = `You are an expert media buyer analyzing a competitor's ad creative.
Provide a detailed breakdown that would help someone replicate its success.

Return ONLY valid JSON with no markdown:
{
  "visual_style": {
    "colors": ["#hex1", "#hex2", "#hex3"],
    "layout_type": "single-product|lifestyle|ugc|graphic|split-screen",
    "imagery_style": "lifestyle|product-only|ugc|illustration|mixed",
    "text_placement": "top|center|bottom|overlay|minimal",
    "visual_hierarchy": "image-first|text-first|balanced"
  },
  "hook_structure": {
    "type": "problem-agitate-solve|curiosity-gap|social-proof|fomo|direct-benefit|storytelling",
    "headline_pattern": "describe the headline formula used",
    "attention_grabber": "what makes someone stop scrolling",
    "emotional_trigger": "fear|desire|curiosity|urgency|belonging"
  },
  "offer_framing": {
    "discount_type": "percentage|fixed-amount|bundle|free-shipping|none",
    "urgency_tactics": ["list of urgency elements"],
    "social_proof_elements": ["reviews|testimonials|user-count|media-mentions"],
    "guarantee": "money-back|satisfaction|none",
    "value_proposition": "main benefit promised"
  },
  "cta_patterns": {
    "text": "exact CTA text",
    "style": "button|link|text-only",
    "color": "#hex",
    "placement": "bottom|floating|multiple"
  },
  "target_audience_signals": {
    "demographics": "age range, gender signals",
    "pain_points_addressed": ["list of problems solved"],
    "lifestyle_indicators": ["interests and behaviors implied"],
    "income_level": "budget|mid-range|premium|luxury"
  },
  "production_quality": {
    "level": "low|medium|high|professional",
    "estimated_cost": "under-100|100-500|500-2000|2000+",
    "tools_likely_used": ["canva|photoshop|professional-shoot|ugc"]
  },
  "what_makes_it_work": [
    "reason 1",
    "reason 2", 
    "reason 3"
  ],
  "weaknesses": [
    "potential improvement 1",
    "potential improvement 2"
  ],
  "replicable_elements": [
    "element you can copy",
    "element you can adapt"
  ],
  "creative_brief": {
    "objective": "what this ad is trying to achieve",
    "key_message": "core message in one sentence",
    "tone": "professional|casual|urgent|playful|luxurious",
    "must_have_elements": ["list of essential elements"]
  }
}`;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
    ]);
    
    const text = result.response.text();
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (error) {
    console.error('Competitor analysis error:', error);
    throw new Error('Failed to analyze competitor ad');
  }
}

// ============================================================================
// HOOK GENERATION - Generate scroll-stopping hooks
// ============================================================================
async function generateHooks({ product_name, product_description, target_audience, tone = 'professional', count = 20 }) {
  const prompt = `Generate ${count} scroll-stopping ad hooks for:

Product: ${product_name}
Description: ${product_description}
Target Audience: ${target_audience}
Tone: ${tone}

Create hooks using these proven frameworks:
- Problem-Agitate-Solve (4 hooks): Start with a pain point
- Curiosity Gap (4 hooks): Make them need to know more
- Social Proof (3 hooks): Use numbers, testimonials, authority
- Fear of Missing Out (3 hooks): Urgency and scarcity
- Direct Benefit (3 hooks): Lead with the transformation
- Pattern Interrupt (3 hooks): Unexpected, controversial, surprising

Return ONLY valid JSON array with no markdown:
[
  {
    "hook": "The actual hook text (max 15 words)",
    "framework": "problem-agitate-solve|curiosity-gap|social-proof|fomo|direct-benefit|pattern-interrupt",
    "why_it_works": "One sentence explanation",
    "best_for": "facebook|instagram|tiktok|story|reel",
    "emotion": "fear|desire|curiosity|urgency|surprise"
  }
]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (error) {
    console.error('Hook generation error:', error);
    throw new Error('Failed to generate hooks');
  }
}

// ============================================================================
// UGC SCRIPT GENERATION - Ready-to-film scripts
// ============================================================================
async function generateUGCScript({ product_name, product_benefits, target_audience, duration = '30s', style = 'testimonial' }) {
  const durationMap = { '15s': 15, '30s': 30, '60s': 60 };
  const seconds = durationMap[duration] || 30;

  const prompt = `Write a ${seconds}-second UGC video script for:

Product: ${product_name}
Benefits: ${product_benefits}
Target Audience: ${target_audience}
Style: ${style} (testimonial|problem-solution|unboxing|day-in-life|before-after)

Return ONLY valid JSON with no markdown:
{
  "title": "Script title",
  "duration": "${duration}",
  "style": "${style}",
  "script": {
    "hook": {
      "time": "0-3s",
      "text": "Opening line to grab attention",
      "delivery": "How to deliver (excited, confused, whispering, etc)",
      "visual": "What should be on screen"
    },
    "body": [
      {
        "time": "3-10s", 
        "text": "Script text",
        "delivery": "Delivery notes",
        "visual": "Visual description"
      },
      {
        "time": "10-20s",
        "text": "Script text", 
        "delivery": "Delivery notes",
        "visual": "Visual description"
      }
    ],
    "cta": {
      "time": "${seconds - 5}s-${seconds}s",
      "text": "Call to action",
      "delivery": "Delivery notes",
      "visual": "Visual description"
    }
  },
  "shot_list": [
    {
      "shot": 1,
      "duration": "3s",
      "type": "talking-head|product-shot|b-roll|screen-recording",
      "framing": "close-up|medium|wide",
      "description": "What to capture"
    }
  ],
  "b_roll_suggestions": [
    "B-roll idea 1",
    "B-roll idea 2",
    "B-roll idea 3"
  ],
  "captions": [
    {"time": "0:00", "text": "Caption text"},
    {"time": "0:03", "text": "Caption text"}
  ],
  "music_mood": "upbeat|chill|dramatic|emotional|trending",
  "props_needed": ["prop 1", "prop 2"],
  "location_suggestions": ["location 1", "location 2"],
  "creator_notes": "Tips for the person filming"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (error) {
    console.error('Script generation error:', error);
    throw new Error('Failed to generate UGC script');
  }
}

// ============================================================================
// AD COPY LOCALIZATION - EN to AR with cultural adaptation
// ============================================================================
async function localizeAdCopy({ text, source_lang = 'en', target_lang = 'ar', context = 'ecommerce', target_region = 'GCC' }) {
  const prompt = `Localize this ${source_lang} ad copy to ${target_lang} for ${target_region} market.

Original text:
"${text}"

Context: ${context} (jewelry|fashion|tech|beauty|food|general)
Target Region: ${target_region}

Requirements:
- Adapt for cultural nuances in Saudi Arabia/GCC
- Maintain persuasive intent and emotional impact
- Adjust idioms and expressions appropriately  
- Consider local buying psychology and preferences
- Keep hook strength and urgency
- Use Modern Standard Arabic with Gulf dialect preferences

Return ONLY valid JSON with no markdown:
{
  "original": "${text}",
  "primary_translation": "Main translation - most balanced",
  "alternatives": [
    {
      "text": "Alternative version",
      "tone": "formal|casual|urgent|luxurious",
      "best_for": "when to use this version"
    }
  ],
  "cultural_adaptations": [
    "What was changed and why"
  ],
  "localization_notes": [
    "Important notes about the translation"
  ],
  "warnings": [
    "Any potential cultural sensitivities"
  ],
  "recommended_version": "Which version to use and why"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text_result = result.response.text();
    return JSON.parse(text_result.replace(/```json|```/g, '').trim());
  } catch (error) {
    console.error('Localization error:', error);
    throw new Error('Failed to localize ad copy');
  }
}

// ============================================================================
// THUMBNAIL A/B PREDICTION - Score and rank thumbnail variations
// ============================================================================
async function predictThumbnails(imagesBase64) {
  const predictions = [];
  
  for (let i = 0; i < imagesBase64.length; i++) {
    const prompt = `You are an expert at predicting ad performance based on thumbnails.
Score this ad thumbnail on each criteria from 0-100.

Return ONLY valid JSON with no markdown:
{
  "scores": {
    "visual_hierarchy": 0-100,
    "contrast": 0-100,
    "color_appeal": 0-100,
    "text_readability": 0-100,
    "emotional_impact": 0-100,
    "scroll_stopping_power": 0-100,
    "brand_professionalism": 0-100,
    "message_clarity": 0-100
  },
  "face_detection": {
    "has_face": true|false,
    "face_prominence": 0-100,
    "eye_contact": true|false
  },
  "overall_score": 0-100,
  "predicted_ctr": "below-average|average|above-average|excellent",
  "predicted_ctr_range": "0.5-1%|1-2%|2-3%|3%+",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "quick_wins": ["easy improvement 1", "easy improvement 2"],
  "verdict": "One sentence summary"
}`;

    try {
      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType: 'image/jpeg', data: imagesBase64[i] } }
      ]);
      
      const text = result.response.text();
      const prediction = JSON.parse(text.replace(/```json|```/g, '').trim());
      prediction.image_index = i;
      predictions.push(prediction);
    } catch (error) {
      console.error(`Thumbnail prediction error for image ${i}:`, error);
      predictions.push({
        image_index: i,
        error: 'Failed to analyze',
        overall_score: 0
      });
    }
  }
  
  // Sort by overall score and add rank
  predictions.sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));
  predictions.forEach((p, idx) => p.rank = idx + 1);
  
  return predictions;
}

// ============================================================================
// CREATIVE BRIEF GENERATION - Full brief from simple inputs
// ============================================================================
async function generateCreativeBrief({ product_name, product_description, target_audience, objective, budget_level = 'medium' }) {
  const prompt = `Create a comprehensive creative brief for an ad campaign.

Product: ${product_name}
Description: ${product_description}
Target Audience: ${target_audience}
Campaign Objective: ${objective}
Budget Level: ${budget_level} (low|medium|high)

Return ONLY valid JSON with no markdown:
{
  "brief_title": "Campaign name",
  "objective": {
    "primary": "Main goal",
    "kpis": ["KPI 1", "KPI 2"]
  },
  "target_audience": {
    "demographics": "Age, gender, location",
    "psychographics": "Interests, values, lifestyle",
    "pain_points": ["Pain 1", "Pain 2"],
    "desires": ["Desire 1", "Desire 2"],
    "objections": ["Objection 1", "Objection 2"]
  },
  "messaging": {
    "key_message": "One core message",
    "supporting_points": ["Point 1", "Point 2", "Point 3"],
    "tone_of_voice": "professional|casual|playful|urgent|luxurious",
    "words_to_use": ["word1", "word2"],
    "words_to_avoid": ["word1", "word2"]
  },
  "creative_direction": {
    "visual_style": "Description of look and feel",
    "color_palette": ["#hex1", "#hex2", "#hex3"],
    "imagery_type": "lifestyle|product|ugc|graphic",
    "reference_brands": ["Brand 1", "Brand 2"],
    "mood": "aspirational|relatable|urgent|calm"
  },
  "deliverables": [
    {
      "format": "feed-post|story|reel|carousel",
      "dimensions": "1080x1080|1080x1920|etc",
      "quantity": 3,
      "notes": "Specific requirements"
    }
  ],
  "hooks_to_test": [
    "Hook 1",
    "Hook 2", 
    "Hook 3"
  ],
  "cta_options": ["CTA 1", "CTA 2"],
  "timeline": {
    "concept": "X days",
    "production": "X days",
    "review": "X days"
  },
  "success_criteria": "How we'll measure success"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (error) {
    console.error('Brief generation error:', error);
    throw new Error('Failed to generate creative brief');
  }
}

// ============================================================================
// SUBJECT DETECTION FOR SMART VIDEO CROP
// ============================================================================
async function detectSubjects(framesBase64) {
  const focal_points = [];
  
  for (let i = 0; i < framesBase64.length; i++) {
    const prompt = `Identify the main subject in this video frame for smart cropping.

Return ONLY valid JSON with no markdown:
{
  "subject_type": "face|person|product|text|graphic|none",
  "subject_description": "Brief description",
  "bounding_box": {
    "x": 0.0-1.0,
    "y": 0.0-1.0,
    "width": 0.0-1.0,
    "height": 0.0-1.0
  },
  "center_point": {
    "x": 0.0-1.0,
    "y": 0.0-1.0
  },
  "importance": 0-100,
  "crop_recommendation": "Keep subject centered when cropping"
}

All coordinates are normalized 0-1 relative to image dimensions.
(0,0) is top-left, (1,1) is bottom-right.`;

    try {
      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType: 'image/jpeg', data: framesBase64[i] } }
      ]);
      
      const text = result.response.text();
      focal_points.push(JSON.parse(text.replace(/```json|```/g, '').trim()));
    } catch (error) {
      console.error(`Subject detection error for frame ${i}:`, error);
      focal_points.push({
        subject_type: 'none',
        center_point: { x: 0.5, y: 0.5 },
        importance: 50
      });
    }
  }
  
  return focal_points;
}

// ============================================================================
// AD IMPROVER - Analyze and suggest improvements
// ============================================================================
async function analyzeAndImprove(imageBase64) {
  const prompt = `You are an expert media buyer reviewing an ad creative.
Analyze this ad and provide specific, actionable improvements.

Return ONLY valid JSON with no markdown:
{
  "current_assessment": {
    "overall_score": 0-100,
    "effectiveness": "low|medium|high",
    "strengths": ["What's working"],
    "weaknesses": ["What's not working"]
  },
  "visual_improvements": [
    {
      "issue": "What's wrong",
      "fix": "How to fix it",
      "priority": "high|medium|low",
      "effort": "easy|medium|hard"
    }
  ],
  "copy_improvements": [
    {
      "current": "Current text if visible",
      "suggested": "Improved version",
      "reason": "Why this is better"
    }
  ],
  "layout_suggestions": [
    "Layout improvement 1",
    "Layout improvement 2"
  ],
  "color_suggestions": {
    "current_palette": ["#hex"],
    "suggested_changes": "What to change",
    "new_palette": ["#hex"]
  },
  "cta_improvements": {
    "current_cta": "Current CTA if visible",
    "suggested_cta": "Improved CTA",
    "placement_suggestion": "Where to place it"
  },
  "a_b_test_ideas": [
    {
      "variable": "What to test",
      "version_a": "Control",
      "version_b": "Variation",
      "hypothesis": "Why this might win"
    }
  ],
  "quick_wins": [
    "Easy fix 1 that will have big impact",
    "Easy fix 2"
  ],
  "estimated_improvement": "X% CTR increase potential"
}`;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
    ]);
    
    const text = result.response.text();
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (error) {
    console.error('Ad improvement analysis error:', error);
    throw new Error('Failed to analyze ad for improvements');
  }
}

module.exports = {
  extractStyle,
  analyzeCompetitorAd,
  generateHooks,
  generateUGCScript,
  localizeAdCopy,
  predictThumbnails,
  generateCreativeBrief,
  detectSubjects,
  analyzeAndImprove
};
