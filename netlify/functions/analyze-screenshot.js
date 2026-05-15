/**
 * Screenshot Analyzer
 *
 * Sends a Dragon Nest character sheet screenshot to Claude's vision API
 * and extracts character stats. Keeps API key server-side.
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

  let image, mimeType;
  try {
    const body = JSON.parse(event.body || '{}');
    image = body.image;
    mimeType = body.mimeType || 'image/png';
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

  const systemPrompt = `You are a Dragon Nest character sheet analyzer. Extract stats from the screenshot and return ONLY valid JSON, no other text.

The character sheet layout:
- Character name and class displayed at the top
- Stats panel on the left side
- Equipment slots arranged around the character model on the right side:
  - LEFT SIDE (top to bottom): Helmet, Top (chest armor), Bottom (leg armor)
  - RIGHT SIDE (top to bottom): Gloves, Boots
  - BOTTOM (below character model): Main Weapon (left), Sub Weapon (right)
- Below the stats panel (under Magic Def), there are 4 accessory slots in a row from left to right:
  Necklace, Earring, Ring 1, Ring 2

CRITICAL: Equipment rarity is determined by the border/glow color of each item icon. Pay very close attention to the color distinctions — getting these right is the most important part of the analysis:

Rarity colors from highest to lowest:
- Legend = BRIGHT RED or CRIMSON border. A strong, deep, saturated RED. Very rare — most characters do NOT have Legend gear.
- Unique = PURPLE or VIOLET border. A cool-toned purple/magenta. Distinctly different from both red and blue.
- Epic = ORANGE or AMBER border. A warm orange/golden/yellowish tone. This is the most common mid-tier rarity.
- Rare = BLUE border (sky blue or royal blue)
- Magic = GREEN border
- Normal = WHITE or GRAY border

COLOR COMPARISON TIPS:
- Orange (Epic) vs Red (Legend): Orange has a warm, yellowish tint. Red is a pure, cool-toned red with no orange.
- Purple (Unique) vs Orange (Epic): Purple has a COOL blue-ish/violet tone. Orange has a WARM yellow-ish tone. If you see a cooler-toned border compared to warm orange equipment, it is purple/Unique.
- IMPORTANT: Every single equipment piece can have a DIFFERENT rarity — armor, weapons, AND accessories. Do NOT assume any pieces match each other. A character might have a Legend helmet, Epic top, Unique gloves, Epic main weapon, Rare necklace, Unique ring, etc. Evaluate each of the 11 slots independently by its own border color.
- When in doubt between two adjacent rarities, lean toward the LOWER one (e.g., Epic over Legend, Unique over Epic).

Enhancement levels appear as small "+X" numbers overlaid on each equipment icon, typically in the bottom-right or center of the icon. They are small white or yellow text. Look carefully at each icon — most equipped items WILL have an enhancement number. Common values range from +9 to +15. If you can make out any number on the icon, report it. If the number is hard to read, give your best guess rather than leaving it as 0. Only use 0 for accessories (which have no enhancement).

Valid class names (use EXACTLY one of these):
Gladiator, Moon Lord, Barbarian, Destroyer, Sniper, Artillery, Tempest, Wind Walker, Saleana, Elestra, Smasher, Majesty, Guardian, Crusader, Saint, Inquisitor, Shooting Star, Gear Master, Adept, Physician, Dark Summoner, Soul Eater, Blade Dancer, Spirit Dancer

Return this JSON structure:
{
  "name": "character name",
  "class": "exact class name from list above",
  "level": 50,
  "equipment": {
    "helmet": { "rarity": "legend", "enhancement": 12 },
    "top": { "rarity": "legend", "enhancement": 12 },
    "bottom": { "rarity": "legend", "enhancement": 12 },
    "gloves": { "rarity": "legend", "enhancement": 12 },
    "boots": { "rarity": "legend", "enhancement": 12 },
    "mainWeapon": { "rarity": "legend", "enhancement": 12 },
    "subWeapon": { "rarity": "legend", "enhancement": 12 },
    "necklace": { "rarity": "epic", "enhancement": 0 },
    "earring": { "rarity": "epic", "enhancement": 0 },
    "ring1": { "rarity": "epic", "enhancement": 0 },
    "ring2": { "rarity": "epic", "enhancement": 0 }
  },
  "stats": {
    "attackPower": 25000,
    "magicAttack": 25000,
    "hp": 165350,
    "finalDamage": 2104,
    "defense": 8448,
    "magicDefense": 7797
  },
  "confidence": "high|medium|low",
  "notes": "any issues or things that couldn't be read clearly"
}

For rarity, use lowercase: "legend", "unique", "epic", "rare", "magic", "normal".
Use null for any field you cannot determine. For enhancement, use the number only (e.g., 12 not "+12").

IMPORTANT: Atk Power and Magic Atk are displayed as ranges (e.g., "17103-19194"). Always use the HIGHER number (the one after the dash). For example, "17103-19194" → attackPower: 19194, "6548-7943" → magicAttack: 7943.`;

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
                text: 'Extract the character stats from this Dragon Nest character sheet screenshot. Return only the JSON object, no markdown formatting or code blocks.'
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

    // Try to parse the JSON from the response
    let parsed;
    try {
      // Handle case where response might have markdown code blocks
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
    console.error('Analyze screenshot error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
