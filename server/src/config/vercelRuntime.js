const mongoose = require('mongoose');
const { connectDatabase } = require('./db');
const store = require('../services/store');

let initialization;

async function initialize() {
  const hosted = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  const demoMode = process.env.DEMO_MODE === 'true';

  if (process.env.VERCEL && process.env.COOKIE_SECURE !== 'false') {
    process.env.COOKIE_SECURE = 'true';
  }

  if (hosted) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      if (demoMode) {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'clarity-health-vercel-demo-secret-key-32chars!';
      } else {
        throw new Error('JWT_SECRET must contain at least 32 characters. Configure JWT_SECRET in your Vercel Project Settings > Environment Variables.');
      }
    }

    if (!process.env.MONGODB_URI) {
      if (demoMode) {
        console.warn('Running in Vercel demo mode with in-memory storage. State will reset between serverless cold starts.');
      } else {
        throw new Error('Missing MONGODB_URI in Vercel environment variables. Configure MONGODB_URI (e.g. from MongoDB Atlas) or set DEMO_MODE=true in Vercel Project Settings > Environment Variables to test with demo data.');
      }
    }
  }

  let connected = mongoose.connection.readyState === 1;
  if (!connected && process.env.MONGODB_URI) {
    connected = await connectDatabase(process.env.MONGODB_URI);
  }

  if (hosted && process.env.MONGODB_URI && !connected) {
    throw new Error('Could not connect to MongoDB. Check your MONGODB_URI and ensure Network Access (0.0.0.0/0) is enabled in MongoDB Atlas.');
  }

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
