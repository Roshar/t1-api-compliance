import { test, expect, request, APIRequestContext } from '@playwright/test';
import 'dotenv/config';
import { getAuthToken } from './helpers/auth';
import { OrderDataFactory, ProductType } from './data/OrderDataFactory';

let api: APIRequestContext;

test.beforeAll(async () => {
  const token = await getAuthToken();
  api = await request.newContext({
    baseURL: process.env.BASE_URL ?? 'https://api.t1.cloud',
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
});

test.afterAll(async () => {
  await api?.dispose();
});

// Тест для Redis
test('Создание Redis кластера', async () => {
  const orderData = OrderDataFactory.createOrderData('redis');
  const body = orderData.buildOrderBody();

  const url = `/redis-manager/api/v1/projects/${process.env.PROJECT_ID}/order-service/orders`;

  console.log('📤 Creating Redis cluster:', body.order.attrs.cluster_name);

  const res = await api.post(url, { data: body });
  const status = res.status();

  if (status !== 200) {
    const errorText = await res.text();
    console.error('❌ Redis order failed:', errorText);
    expect(status).toBe(200);
  } else {
    console.log('✅ Redis order created successfully');
  }
});

// Тест для MySQL
test('Создание MySQL кластера', async () => {
  const orderData = OrderDataFactory.createOrderData('mysql');
  const body = orderData.buildOrderBody();

  const url = `/redis-manager/api/v1/projects/${process.env.PROJECT_ID}/order-service/orders`;

  console.log('📤 Creating MySQL cluster:', body.order.attrs.cluster_name);

  const res = await api.post(url, { data: body });
  const status = res.status();

  if (status !== 200) {
    const errorText = await res.text();
    console.error('❌ MySQL order failed:', errorText);
    expect(status).toBe(200);
  } else {
    console.log('✅ MySQL order created successfully');
  }
});
