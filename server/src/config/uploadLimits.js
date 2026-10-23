const configured = Number(process.env.MAX_UPLOAD_MB || 10);
const validConfigured = Number.isFinite(configured) && configured > 0 ? configured : 10;
const maxUploadMb = process.env.VERCEL ? Math.min(validConfigured, 4) : validConfigured;

module.exports = { maxUploadMb };
