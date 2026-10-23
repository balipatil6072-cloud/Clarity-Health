const { app } = require('../server/src/app');
const { ensureVercelReady } = require('../server/src/config/vercelRuntime');

module.exports = async function vercelApiHandler(req, res) {
  try {
    await ensureVercelReady();
  } catch (error) {
    console.error('Vercel API setup failed:', error.name || 'Error', error.code || '');
    return res.status(503).json({ error: 'The API is not configured. Check its MongoDB and security environment variables.' });
  }

  if (!req.url.startsWith('/api/')) req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  return app(req, res);
};
