/**
 * Lineup Screenshot Analyzer
 *
 * Sends a Dragon Nest raid party screenshot to Claude's vision API
 * and extracts character names and classes from the party list.
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

  let image, mimeType, knownPlayers;
  try {
    const body = JSON.parse(event.body || '{}');
    image = body.image;
    mimeType = body.mimeType || 'image/png';
    knownPlayers = body.knownPlayers || [];
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

  const playerListHint = knownPlayers.length > 0
    ? `\n\nHere is a list of known player character names to help with matching. If a name in the screenshot closely matches one of these, use the known name exactly:\n${knownPlayers.join(', ')}`
    : '';

  const systemPrompt = `You are a Dragon Nest raid party screenshot analyzer. Extract the character names visible in the party/raid list screenshot.

The screenshot may show:
- A raid party list with up to 8 characters
- Each entry typically shows "Lv. 50 CharacterName" with a character portrait
- The party list is usually arranged in a 2-column grid (4 rows × 2 columns)
- Names might be partially obscured or have special characters
- Read left-to-right, top-to-bottom (left column entry first, then right column entry, for each row)

Return this JSON structure:
{
  "players": [
    { "name": "CharacterName" },
    { "name": "CharacterName2" }
  ],
  "notes": "any issues or things that couldn't be read clearly"
}

Rules:
- Return players in the order they appear in the screenshot (top to bottom)
- Read character names as accurately as possible — spelling matters for matching
- If a name is hard to read, give your best guess and mention it in notes
- Return ONLY the JSON, no markdown or code blocks${playerListHint}`;

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
        max_tokens: 1024,
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
                text: 'Extract the character names and classes from this Dragon Nest raid party screenshot. Return only the JSON object.'
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
        body: JSON.stringify({ raw: text, error: 'Could not parse response as JSON' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(parsed)
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal function error', message: error.message })
    };
  }
}
