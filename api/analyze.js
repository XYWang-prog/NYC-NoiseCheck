const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { projects } = req.body;
    if (!projects || !projects.length) {
      return res.json({ analysis: 'No construction projects found in this area.' });
    }

    const projectList = projects.map(p =>
      `- ${p.work_type}: ${p.job_description || 'No description'} | Issued: ${p.issued_date || 'N/A'} | Distance: ${p.distance}m`
    ).join('\n');

    const prompt = `You are helping a NYC apartment resident understand the construction noise they would experience if they lived at a specific address.

Below are construction projects within 150m of that address. Distance (m) tells you how close each project is. If distance is very small (~0-30m), the project is likely IN the same building the person lives in.

Analyze the noise impact from the perspective of someone living INSIDE their apartment in this building. Key rules:

1. SAME-BUILDING vs NEARBY: 0-30m = likely same building (noise through walls/floors), 30-150m = nearby (street noise through windows only).

2. READ THE JOB DESCRIPTION TO JUDGE REAL NOISE:
   - WHAT is being demolished? A concrete building = very loud for weeks. Drywall/partitions = minor, short-term. A shed or fence = negligible.
   - WHAT is being built? Steel-frame high-rise = constant heavy noise. Wood-frame house = moderate, intermittent. Interior finishing = quiet.
   - WHAT materials and methods? Concrete cutting, jackhammer, pile driving, steel welding = very loud. Painting, tiling, cabinet install, drywall = barely audible.

3. LOW NOISE (do NOT warn about these): interior renovation, bathroom/kitchen remodel, painting, tiling, cabinet/trim, fixture replacement, drywall, partitions, cosmetic work. If "INTERIOR" or "RENOVATION" appears without mentioning demolition or structural work, it is quiet.

4. HIGH NOISE (warn about these): full demolition of structures, foundation excavation, earth work involving heavy machinery, structural steel erection, concrete cutting/drilling, pile driving, major pipe replacement, jackhammer work.

5. BE SPECIFIC: Instead of generic "construction noise", say "concrete cutting will produce sustained high-pitched noise" or "interior finishing will only cause light occasional tapping". Distinguish truly disruptive projects from minor ones. If ALL projects are quiet, reassure the resident clearly. Write your analysis entirely in English, with no Chinese characters.

Projects:
${projectList}

Write a 2-4 sentence analysis in English. Be honest: if projects are likely in the same building, warn clearly about expected indoor disruption. If only distant projects exist, reassure the resident. Mention specific distances and work types that matter most.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });

    const analysis = completion.choices[0].message.content;
    res.json({ analysis });

  } catch (error) {
    console.error('OpenAI API error:', error.message);
    res.status(500).json({ analysis: null, error: 'AI analysis unavailable. Please try again later.' });
  }
};
