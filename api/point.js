// Vercel serverless: single-point noise computation (logic in lib/grid.js)
const { computePointNoise } = require('../lib/grid');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lat, lng, dateStart, dateEnd } = req.body;
    res.json(await computePointNoise(lat, lng, dateStart, dateEnd));
  } catch (error) {
    if (error.message === 'Invalid coordinates') {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
    console.error('Point error:', error.message);
    res.status(500).json({ error: 'Point computation failed', details: error.message });
  }
};
