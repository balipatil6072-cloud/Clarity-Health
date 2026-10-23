const mongoose = require('mongoose');
const { connectDatabase } = require('./db');
const store = require('../services/store');

let initialization;

async function initialize() {
  const hosted = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  const demoMode = process.env.DEMO_MODE === 'true';

  if (hosted) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required on Vercel.');
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
    if (process.env.COOKIE_SECURE !== 'true') throw new Error('COOKIE_SECURE must be true on Vercel.');
    if (process.env.VERCEL_ENV === 'production' && demoMode) throw new Error('DEMO_MODE must be false for production deployments.');
    if (process.env.VERCEL_ENV === 'preview' && demoMode) {
      const demoPasswords = ['DEMO_PATIENT_PASSWORD', 'DEMO_DOCTOR_PASSWORD', 'DEMO_ADMIN_PASSWORD'];
      if (demoPasswords.some((name) => !process.env[name] || process.env[name].length < 16)) {
        throw new Error('Preview demo accounts need three passwords of at least 16 characters.');
      }
    }
  }

  let connected = mongoose.connection.readyState === 1;
  if (!connected && process.env.MONGODB_URI) connected = await connectDatabase(process.env.MONGODB_URI);
  if (hosted && !connected) throw new Error('MongoDB connection is required on Vercel.');

  store.setDatabaseEnabled(connected);
  if (demoMode) await store.seedDemo();
}

function ensureVercelReady() {
  if (!initialization) {
    initialization = initialize().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

module.exports = { ensureVercelReady };
