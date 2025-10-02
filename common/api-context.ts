import { APIRequestContext, request } from '@playwright/test';
import { getAuthToken } from '../helpers/auth';

let api: APIRequestContext;
let tokenExpiryTime: number = 0;
const TOKEN_LIFETIME = 55 * 60 * 1000;

export async function setupAPIContext(baseURL: string = 'https://api.t1.cloud'): Promise<APIRequestContext> {
  if (api) {
    await api.dispose();
  }

  const token = await getAuthToken();
  api = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  tokenExpiryTime = Date.now() + TOKEN_LIFETIME;
  return api;
}

export async function refreshAPIContext(baseURL: string = 'https://api.t1.cloud'): Promise<APIRequestContext> {
  console.log('Обновляем API контекст...');
  
  if (api) {
    await api.dispose();
  }

  const token = await getAuthToken();
  api = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  tokenExpiryTime = Date.now() + TOKEN_LIFETIME;
  return api;
}

export function getAPIContext(): APIRequestContext {
  if (!api) {
    throw new Error('API context not initialized. Call setupAPIContext first.');
  }
  return api;
}

export function shouldRefreshToken(): boolean {
  return Date.now() > tokenExpiryTime - 5 * 60 * 1000;
}

export async function disposeAPIContext() {
  await api?.dispose();
}