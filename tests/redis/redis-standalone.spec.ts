import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { OrderDataFactory } from '../data/OrderDataFactory';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';

const PROJECT_ID = process.env.PROJECT_ID!;

//Получаем актуальный токен
test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

// Заказываем редис (1 ВМ, 7.2.5 версии, с ТЛС)
test('Создание Redis Standalone', async () => {
  const orderData = OrderDataFactory.createOrderData('redis-standalone');
  const body = orderData.buildOrderBody();

  let api = getAPIContext();

  // Проверка свежести токена
  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  const url = `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders`;

  // оставить пока для отладки
  //console.log('Создание заказа:', body.order.attrs.cluster_name);
  
  const res = await api.post(url, { data: body });
  const status = res.status();

  if (status !== 200) {
    const errorText = await res.text();
    console.error('Redis Sentinel заказ упал:', errorText);
    expect(status).toBe(200);
  } else {
    console.log('Redis standalone успешно создан');
  }
});
