const { app } = require('../server/src/app');
const { ensureVercelReady } = require('../server/src/config/vercelRuntime');

module.exports = async function vercelApiHandler(req, res) {
  try {
    await ensureVercelReady();
  } catch (error) {
    console.error('Vercel API setup failed:', error.message || error);
    return res.status(503).json({
      error: error.message || 'The API is not configured. Check its MongoDB and security environment variables.'
    });
  }

  if (req.url.includes('[...path]') && req.query?.path) {
    const subpath = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    const urlObj = new URL(req.url, 'http://localhost');
    urlObj.searchParams.delete('path');
    const search = urlObj.search;
    req.url = `/api/${subpath}${search}`;
  } else if (!req.url.startsWith('/api/')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }

  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    res.on('error', reject);
    app(req, res);
  });
};
