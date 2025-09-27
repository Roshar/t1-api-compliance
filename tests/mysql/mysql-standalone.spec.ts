import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { OrderDataFactory } from '../data/OrderDataFactory';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Создание MySQL standalone кластера', async () => {
  test.setTimeout(30 * 60 * 1000);

  const orderData = OrderDataFactory.createOrderData('mysql-standalone');
  const body = orderData.buildOrderBody();
  const clusterName = body.order.attrs.cluster_name;

  console.log('Создаем заказ:', clusterName);

  let api = getAPIContext();
  
  // Проверка свежести токена
  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  const createResponse = await api.post(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders`,
    { data: body },
  );

  expect(createResponse.status()).toBe(200);
  const createResult = await createResponse.json();
  const orderId = createResult[0].id;

  console.log('Заказ создан, ID:', orderId);

  // Ждем развертывания
  let isDeployed = false;
  const startTime = Date.now();
  const maxWaitTime = 25 * 60 * 1000;
  let checkCount = 0;

  while (!isDeployed && Date.now() - startTime < maxWaitTime) {
    checkCount++;
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Обновляем токен каждые 10 минут если нужно
    if (checkCount % 10 === 0 && shouldRefreshToken()) {
      console.log('Обновляем токен...');
      await refreshAPIContext();
      api = getAPIContext();
    }

    try {
      const listResponse = await api.get(
        `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders?page=1&per_page=5`
      );

      if (listResponse.status() === 200) {
        const listResult = await listResponse.json();
        const ourOrder = listResult.list.find((order: any) => order.id === orderId);

        if (ourOrder && ourOrder.status === 'success') {
          isDeployed = true;
          console.log('Кластер развернут!');
          break;
        }
      }
    } catch (error) {
      console.log('Ошибка:', String(error));
      // При ошибке пробуем обновить токен
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  expect(isDeployed).toBe(true);
});