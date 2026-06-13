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
- Legend = RED or PINK-RED border. A warm-toned color sitting between pure red and coral/pink. Hue is in the red-to-magenta-red range (roughly 340°–10° on the color wheel). Looks like crimson, rose, or hot pink — NOT purple. If the border looks reddish or pinkish (even a bright pink-red), it is Legend.
- Unique = PURPLE or VIOLET border. A true cool-toned purple/violet sitting clearly in the blue-violet range (roughly 260°–290° on the color wheel). Has a noticeable BLUE component. If the color has no blue in it and reads as red/pink/rose, it is NOT Unique.
- Epic = ORANGE or AMBER border. A warm orange/golden/yellowish tone.
- Rare = BLUE border (sky blue or royal blue).
- Magic = GREEN border.
- Normal = WHITE or GRAY border.

COLOR COMPARISON TIPS:
- Legend (red/pink-red) vs Unique (purple): Legend is WARM with no blue in it — even a bright pink-red is still Legend. Unique is COOL with a clear blue/violet component. Do NOT call something Unique just because it looks bright or saturated; check whether the hue is in the red family or the violet family.
- Orange (Epic) vs Red (Legend): Orange has a yellow tint. Red/pink-red has no yellow.
- Every single equipment piece can have a DIFFERENT rarity — armor, weapons, AND accessories. Do NOT assume any pieces match each other. Evaluate each of the 11 slots independently by its own border color.
- Do not bias toward any particular rarity. Many characters have full Legend gear; many have mixed gear. Report what you actually see in each border.

PER-SLOT PROCESS (follow this for every one of the 11 slots, do not skip it):
1. Look ONLY at that slot's border and write the literal color you observe into its "borderColor" field. Be specific about hue: e.g. "pink-red", "crimson", "rose", "orange", "amber", "purple", "violet", "blue", "green", "white". Describe the color before you think about rarity.
2. Map that borderColor to a rarity using the table above.
Decision rule to resist the most common mistake: a warm RED / PINK-RED / ROSE / CRIMSON border is Legend, NOT Epic. Epic must look ORANGE or AMBER with an unmistakable YELLOW tint. If you do not clearly see yellow in the border, it is NOT Epic — it is almost certainly Legend (reddish) or Unique (purplish). When torn between Epic and Legend on a reddish border, choose Legend.

Enhancement levels appear as small "+X" numbers overlaid on each equipment icon, typically in the bottom-right or center of the icon. They are small white or yellow text. Look carefully at each icon — most equipped items WILL have an enhancement number. Common values range from +9 to +15. If you can make out any number on the icon, report it. If the number is hard to read, give your best guess rather than leaving it as 0. Only use 0 for accessories (which have no enhancement).

Valid class names (use EXACTLY one of these):
Gladiator, Moon Lord, Barbarian, Destroyer, Dark Avenger, Sniper, Artillery, Tempest, Wind Walker, Saleana, Elestra, Smasher, Majesty, Guardian, Crusader, Saint, Inquisitor, Shooting Star, Gear Master, Adept, Physician, Dark Summoner, Soul Eater, Blade Dancer, Spirit Dancer

Return this JSON structure. IMPORTANT: the rarity and enhancement values shown below are FORMAT PLACEHOLDERS ONLY — they are deliberately mixed so you do not copy them. Read each border color yourself and report what you actually see; do NOT default any slot to the value shown here.
{
  "name": "character name",
  "class": "exact class name from list above",
  "level": 50,
  "equipment": {
    "helmet": { "borderColor": "violet", "rarity": "unique", "enhancement": 12 },
    "top": { "borderColor": "pink-red", "rarity": "legend", "enhancement": 13 },
    "bottom": { "borderColor": "orange", "rarity": "epic", "enhancement": 11 },
    "gloves": { "borderColor": "crimson", "rarity": "legend", "enhancement": 12 },
    "boots": { "borderColor": "purple", "rarity": "unique", "enhancement": 12 },
    "mainWeapon": { "borderColor": "rose", "rarity": "legend", "enhancement": 13 },
    "subWeapon": { "borderColor": "pink-red", "rarity": "legend", "enhancement": 12 },
    "necklace": { "borderColor": "crimson", "rarity": "legend", "enhancement": 0 },
    "earring": { "borderColor": "violet", "rarity": "unique", "enhancement": 0 },
    "ring1": { "borderColor": "pink-red", "rarity": "legend", "enhancement": 0 },
    "ring2": { "borderColor": "orange", "rarity": "epic", "enhancement": 0 }
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
        model: 'claude-opus-4-8',
        max_tokens: 6000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
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
    // With adaptive thinking enabled, content[0] is a thinking block — grab the text block(s).
    const text = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('') || '';

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
