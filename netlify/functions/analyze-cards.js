/**
 * Card Page Analyzer
 *
 * Sends a Dragon Nest monster-card-page screenshot (4x4 grid, 16 slots)
 * to Claude's vision API and extracts the rarity per slot.
 * Keeps API key server-side.
 */

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Anthropic API key not configured' })
    };
  }

  let image, mimeType, page;
  try {
    const body = JSON.parse(event.body || '{}');
    image = body.image;
    mimeType = body.mimeType || 'image/png';
    page = body.page || 1;
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid request body' })
    };
  }

  if (!image) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing image data' })
    };
  }

  const systemPrompt = `You are a Dragon Nest monster card panel analyzer. Extract card rarities from the screenshot and return ONLY valid JSON, no other text.

The screenshot shows the in-game Card panel: a 4x4 grid of 16 card slots, read LEFT-TO-RIGHT, TOP-TO-BOTTOM (slot 0 is top-left, slot 15 is bottom-right).

Each slot is either EMPTY (dark/black background with no card art and no border highlight) or holds a card with a colored border indicating rarity.

CRITICAL: Each card's rarity is determined SOLELY by the border/frame color around its icon. The card art inside does not matter — only the frame color.

Rarity colors from highest to lowest:
- legend = BRIGHT RED or CRIMSON border. A strong, deep, saturated RED.
- unique = PURPLE or VIOLET border. A cool-toned purple/magenta.
- epic = ORANGE or AMBER border. A warm orange/golden/yellowish tone.
- rare = BLUE border (sky blue or royal blue).
- magic = GREEN border. A saturated green, often with a slight yellow tint.
- empty = no card present in the slot (no border, just dark background).

COLOR TIPS:
- Orange (epic) vs Red (legend): Orange has a warm, yellowish tint. Red is a pure, cool-toned red.
- Purple (unique) vs Orange (epic): Purple is cool-toned/violet. Orange is warm/yellow.
- Green (magic) vs Blue (rare): Green leans warm/yellowish; blue is cool. If unsure between blue-green and pure green, the green-leaning one is magic.
- If a slot has any visible card art with a colored frame, it is NOT empty.

Return EXACTLY this JSON shape, one entry per slot, exactly 16 entries:
{
  "page": ${page},
  "slots": [
    { "position": 0, "rarity": "legend" },
    { "position": 1, "rarity": "magic" },
    { "position": 2, "rarity": "unique" },
    ...
    { "position": 15, "rarity": null }
  ],
  "confidence": "high|medium|low",
  "notes": "any issues or unclear slots"
}

Use lowercase for rarity values: "legend", "unique", "epic", "rare", "magic".
Use null (not "empty" or "none") for empty slots.
Always return exactly 16 slot entries with positions 0 through 15.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: image
                }
              },
              {
                type: 'text',
                text: `Extract the rarity of each of the 16 card slots in this Dragon Nest Card panel screenshot (page ${page}). Return only the JSON object, no markdown.`
              }
            ]
          }
        ],
        system: systemPrompt
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Vision API request failed', details: errorText })
      };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ raw: text, error: 'Could not parse structured data from response' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(parsed)
    };

  } catch (error) {
    console.error('Analyze cards error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
