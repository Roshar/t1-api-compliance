import { test, expect, request, APIRequestContext } from '@playwright/test';
import 'dotenv/config';
import { getAuthToken } from '../helpers/auth';
import { OrderDataFactory } from '../data/OrderDataFactory';

let api: APIRequestContext;
const PROJECT_ID = process.env.PROJECT_ID!;

// Функция для обновления API контекста с новым токеном
async function refreshAPIContext() {
  if (api) {
    await api.dispose();
  }

  const token = await getAuthToken();
  api = await request.newContext({
    baseURL: process.env.BASE_URL ?? 'https://api.t1.cloud',
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

test.beforeAll(async () => {
  await refreshAPIContext();
});

test.afterAll(async () => {
  await api?.dispose();
});

test('Создание MySQL standalone кластера и ожидание развертывания', async () => {
  test.setTimeout(30 * 60 * 1000); // 30 минут

  // Создание заказа
  const orderData = OrderDataFactory.createOrderData('mysql-standalone');
  const body = orderData.buildOrderBody();
  const clusterName = body.order.attrs.cluster_name;

  console.log('Создаем заказ:', clusterName);

  const createResponse = await api.post(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders`,
    { data: body },
  );

  expect(createResponse.status()).toBe(200);
  const createResult = await createResponse.json();
  const orderId = createResult[0].id;

  console.log('Заказ создан, ID:', orderId);
  console.log('Начальный статус:', createResult[0].status);

  // Ждем пока заказ развернется
  console.log('Ожидаем развертывания...');

  let isDeployed = false;
  const startTime = Date.now();
  const maxWaitTime = 25 * 60 * 1000; // 25 минут
  let checkCount = 0;

  while (!isDeployed && Date.now() - startTime < maxWaitTime) {
    checkCount++;

    // Ждем 60 секунд между проверками
    await new Promise((resolve) => setTimeout(resolve, 60000));

    try {
      // Обновляем токен каждые 10 проверок (каждые 10 минут)
      if (checkCount % 10 === 0) {
        console.log('Обновляем токен авторизации...');
        await refreshAPIContext();
      }

      const listResponse = await api.get(
        `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders?page=1&per_page=5&f[status][]=pending&f[status][]=success&sort_field=created_at&sort_direction=desc`,
      );

      if (listResponse.status() === 200) {
        const listResult = await listResponse.json();

        // Ищем наш заказ в списке
        const ourOrder = listResult.list.find((order: any) => order.id === orderId);

        if (ourOrder) {
          const minutesPassed = Math.round((Date.now() - startTime) / 60000);
          console.log(`[${minutesPassed} мин] Текущий статус:`, ourOrder.status);

          if (ourOrder.status === 'success') {
            isDeployed = true;
            console.log('Кластер развернут!');
            break;
          }
        } else {
          console.log('Заказ не найден в списке, продолжаем ждать...');
        }
      }
    } catch (error) {
      console.log('Ошибка при проверке статуса:', error.message);

      // Пробуем обновить токен при ошибке
      console.log('Пробуем обновить токен...');
      await refreshAPIContext();
    }
  }

  if (isDeployed) {
    console.log('Тест успешно завершен!');
  } else {
    console.log('Время ожидания истекло, проверьте статус вручную');
  }

  expect(isDeployed).toBe(true);
});
