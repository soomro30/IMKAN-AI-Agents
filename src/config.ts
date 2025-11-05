import dotenv from 'dotenv';
import { getMobileNumber } from './electron-bridge.js';

const envPath = process.env.DOTENV_CONFIG_PATH;
if (envPath) {
  console.log('Loading .env from:', envPath);
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

export const config = {
  browserbase: {
    apiKey: process.env.BROWSERBASE_API_KEY || '',
    projectId: process.env.BROWSERBASE_PROJECT_ID || '',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },
  tamm: {
    url: 'https://tamm.abudhabi/',
    mobileNumber: getMobileNumber(),
  },
};

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.browserbase.apiKey) {
    errors.push('BROWSERBASE_API_KEY is required');
  }
  if (!config.browserbase.projectId) {
    errors.push('BROWSERBASE_PROJECT_ID is required');
  }
  if (!config.tamm.mobileNumber) {
    errors.push('TAMM_MOBILE_NUMBER is required');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}
