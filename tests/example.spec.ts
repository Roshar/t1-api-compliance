import { test, expect } from '@playwright/test';

test('Get Auth Form', async ({ request }) => {
  const res = await request.get('https://console.t1.cloud/');
  console.log(res);
});
