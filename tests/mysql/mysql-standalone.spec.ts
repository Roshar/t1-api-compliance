import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { OrderDataFactory } from '../data/OrderDataFactory';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';
import { testData } from '../common/test-data'; 

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

/**
 * Создает MySQL кластер и ждет пока он встанет
 *  Основные действия теста:
 * - Заказывает кластер
 * - При необходимости смена протухшего токена
 * - Загоняем данные о созданном кластере в глоб хранилище
 */
test('Создание MySQL standalone кластера', async () => {
  test.setTimeout(30 * 60 * 1000);

  const orderData = OrderDataFactory.createOrderData('mysql-standalone');
  const body = orderData.buildOrderBody();
  const clusterName = body.order.attrs.cluster_name;

  console.log('Создаем заказ:', clusterName);

  let api = getAPIContext();
  
  // Проверяем свежесть токена
  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Создаем заказ
  const createResponse = await api.post(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders`,
    { data: body },
  );

  // Проверяем что заказ принят
  expect(createResponse.status()).toBe(200);
  const createResult = await createResponse.json();
  const orderId = createResult[0].id;

  console.log('Заказ создан, ID:', orderId);

  // Ждем пока кластер развернется
  let isDeployed = false;
  const startTime = Date.now();
  const maxWaitTime = 25 * 60 * 1000; // Максимум 25 минут ожидания
  let checkCount = 0;

  while (!isDeployed && Date.now() - startTime < maxWaitTime) {
    checkCount++;
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Каждые 10 минут чекаем токен
    if (checkCount % 10 === 0 && shouldRefreshToken()) {
      console.log('Обновляем токен...');
      await refreshAPIContext();
      api = getAPIContext();
    }

    try {
      // Запрашиваем список заказов для проверки статуса
      const listResponse = await api.get(
        `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders?page=1&per_page=5`
      );

      if (listResponse.status() === 200) {
        const listResult = await listResponse.json();
        // Ищем наш заказ в списке
        const ourOrder = listResult.list.find((order: any) => order.id === orderId);

        // Ищем статус success - кластер развернут
        if (ourOrder && ourOrder.status === 'success') {
          isDeployed = true;
          console.log('Кластер развернут!');

         // Получаем информацию о заказе (item_id)
          const detailResponse = await api.get(
            `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
          );
          const detailData = await detailResponse.json();
          
          // Ищем managed item 
          const managedItem = detailData.data.find((item: any) => item.type === 'managed');
          const itemId = managedItem.item_id;
          
          // Сохраняем данные в наше хранилище глобальное для дальнейшего использования при выподлнении действий внутри кластера
          testData.mysqlCluster = {
            orderId,
            itemId,
            clusterName
          };
          
          console.log('Данные  сохранены в глоб. хранилище:', { orderId, itemId });
          break; 
        }
      }
    } catch (error) {
      // При ошибке сети или авторизации пробуем обновить токен
      console.log('Ошибка:', String(error));
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  // Финальная проверка
  expect(isDeployed).toBe(true);
});