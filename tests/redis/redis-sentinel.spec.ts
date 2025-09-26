import { test, expect, request, APIRequestContext } from '@playwright/test';
import 'dotenv/config';
import { getAuthToken } from '../helpers/auth';
import { OrderDataFactory, ProductType } from '../data/OrderDataFactory';

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

// Заказываем редис Сентинел (3 ВМ, 7.2.5 версии, с ТЛС)
test('Создание Redis Sentinel', async () => {
  const orderData = OrderDataFactory.createOrderData('redis-sentinel');
  const body = orderData.buildOrderBody();

  const url = `/redis-manager/api/v1/projects/${process.env.PROJECT_ID}/order-service/orders`;

  // оставить пока для отладки
  //console.log('Создание заказа:', body.order.attrs.cluster_name);

  const res = await api.post(url, { data: body });
  const status = res.status();

  if (status !== 200) {
    const errorText = await res.text();
    console.error('Redis Sentinelзаказ упал:', errorText);
    expect(status).toBe(200);
  } else {
    console.log('Redis Sentinel успешно создан');
  }
});
