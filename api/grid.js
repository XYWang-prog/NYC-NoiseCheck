// Vercel serverless: noise grid computation (logic in lib/grid.js)
const { computeGrid } = require('../lib/grid');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dateStart, dateEnd } = req.body;
    res.json(await computeGrid(dateStart, dateEnd));
  } catch (error) {
    console.error('Grid error:', error.message);
    res.status(500).json({ error: 'Grid generation failed' });
  }
};
