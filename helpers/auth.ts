import { request } from '@playwright/test';

export async function getAuthToken(): Promise<string> {
  const {
    AUTH_URL,
    AUTH_CLIENT_ID,
    AUTH_CLIENT_SECRET,
    AUTH_GRANT = 'client_credentials',
  } = process.env;

  if (!AUTH_URL || !AUTH_CLIENT_ID || !AUTH_CLIENT_SECRET) {
    throw new Error('AUTH_URL / AUTH_CLIENT_ID / AUTH_CLIENT_SECRET are required');
  }

  console.log('Getting auth token from:', AUTH_URL);

  const ctx = await request.newContext();

  const form = new URLSearchParams();
  form.set('grant_type', AUTH_GRANT);
  form.set('client_id', AUTH_CLIENT_ID);
  form.set('client_secret', AUTH_CLIENT_SECRET);

  const res = await ctx.post(AUTH_URL, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    data: form.toString(),
  });

  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Auth failed: ${res.status()} ${text}`);
  }

  const json = await res.json();
  const token = json.access_token as string | undefined;

  if (!token) {
    console.error('Auth response:', json);
    throw new Error('No access_token in response');
  }

  console.log('Auth token received successfully');
  await ctx.dispose();

  return token;
}
