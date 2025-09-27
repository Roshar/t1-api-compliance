import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { OrderDataFactory } from '../data/OrderDataFactory';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';


//Получаем актуальный токен
test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

// Заказываем редис Сентинел (3 ВМ, 7.2.5 версии, с ТЛС)
test('Создание Redis Sentinel', async () => {
  const orderData = OrderDataFactory.createOrderData('redis-sentinel');
  const body = orderData.buildOrderBody();

  let api = getAPIContext();

  // Проверка свежести токена
  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  const url = `/redis-manager/api/v1/projects/${process.env.PROJECT_ID}/order-service/orders`;

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
