const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// NOTE: this function is duplicated verbatim in server.js /api/analyze — keep both in sync
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { projects, summary } = req.body;
    if (!projects || !projects.length) {
      return res.json({ analysis: 'No construction projects found in this area.' });
    }

    const projectList = projects.map(p =>
      `- ${p.work_type}: ${p.job_description || 'No description'} | Issued: ${p.issued_date || 'N/A'} | Distance: ${p.distance}m`
    ).join('\n');

    // Optional modeled facts about the address (missing summary = legacy behavior)
    let summaryRules = '';
    let summaryBlock = '';
    if (summary) {
      summaryRules = `
6. USE THE MODELED dBA AS THE QUANTITATIVE ANCHOR for severity: do not contradict its rating; reconcile it with distance and job details (e.g., a loud rating driven by one adjacent project). Mention the modeled level if it is notable.

7. WRITE FROM THE INDOOR PERSPECTIVE: the resident's actual exposure is the estimated indoor level (windows closed by default). Use those indoor numbers when quoting a level; mention the window-open level when advising about opening windows.

8. TREAT 311 COMPLAINTS as empirical corroboration only: a low count does not override the model. If the count is notable, mention it as "resident complaints nearby" rather than proof.
`;
      const closedDb = summary.facadeClosedDb ?? 18;
      const openDb = summary.facadeOpenDb ?? 8;
      summaryBlock = `Modeled facts about this address (${summary.address || 'this address'} as of ${summary.asOf || 'unknown date'}):
${summary.dba !== null && summary.dba !== undefined ? `- Noise model: ${summary.dba} dBA outdoor weekday-daytime Leq — rating ${summary.feeling || 'n/a'} (${summary.feelingDetail || ''}).` : '- Noise model: no major construction within 150m of this address.'}
${summary.indoorClosed !== null && summary.indoorClosed !== undefined ? `- Estimated indoor level: ${summary.indoorClosed} dBA with windows closed, ${summary.indoorOpen} dBA with window open (outdoor minus ${closedDb} dB / ${openDb} dB typical facade loss).` : ''}
${summary.complaints311 !== null && summary.complaints311 !== undefined ? `- 311 construction-noise complaints within 400m in the last 3 months: ${summary.complaints311} (real-time count).` : '- 311 complaint data unavailable — do not invent numbers.'}
`;
    }

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

5. BE SPECIFIC: Instead of generic "construction noise", say "concrete cutting will produce sustained high-pitched noise" or "interior finishing will only cause light occasional tapping". Distinguish truly disruptive projects from minor ones. If ALL projects are quiet, reassure the resident clearly. Write your analysis entirely in English, with no Chinese characters.${summaryRules}
${summaryBlock}Projects:
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
