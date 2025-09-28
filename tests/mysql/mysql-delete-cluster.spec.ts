import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';
import { testData } from '../common/test-data';

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Удаление MySQL кластера', async () => {
  test.setTimeout(30 * 60 * 1000); // 30 минут для удаления
  
  if (!testData.mysqlCluster) {
    console.log('Нет данных кластера для удаления, пропускаем тест');
    test.skip();
    return;
  }
  
  const { orderId: ORDER_ID, itemId: ITEM_ID, clusterName } = testData.mysqlCluster;
  
  console.log('Начинаем удаление кластера:', clusterName);
  console.log('Используем данные:', { ORDER_ID, ITEM_ID });

  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Отправляем запрос на удаление кластера
  const deleteClusterPayload = {
    project_name: PROJECT_ID,
    id: ORDER_ID,
    item_id: ITEM_ID,
    order: {
      attrs: {}
    }
  };

  const deleteResponse = await api.patch(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/delete_cluster_for_mysql`,
    { data: deleteClusterPayload }
  );

  console.log('Статус ответа на удаление кластера:', deleteResponse.status());

  if (deleteResponse.status() !== 200) {
    const errorBody = await deleteResponse.text();
    console.log('Ошибка от сервера:', errorBody);
    expect(deleteResponse.status()).toBe(200);
  }

  console.log('Запрос на удаление кластера отправлен успешно');

  // Ждем завершения операции удаления
  console.log('Ждем завершения операции удаления кластера...');

  const startTime = Date.now();
  const maxWaitTime = 25 * 60 * 1000; // 25 минут максимум
  let isDeleted = false;
  let retryCount = 0;
  const maxRetries = 3;

  while (!isDeleted && Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 60000));

    if (shouldRefreshToken()) {
      console.log('Обновляем токен...');
      await refreshAPIContext();
      api = getAPIContext();
    }

    try {
      const statusResponse = await api.get(
        `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${ORDER_ID}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем статус последнего действия
      if (statusData.last_action && statusData.last_action.status === 'success') {
        console.log('Последнее действие завершено успешно');
      }

      // Ищем managed item и проверяем его состояние
      const managedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
      
      if (managedItem) {
        const itemState = managedItem.data.state;
        console.log(`Состояние managed item: ${itemState}`);
        
        // Если managed item в состоянии 'deleted' - кластер удален
        if (itemState === 'deleted') {
          isDeleted = true;
          console.log('Managed item удален - кластер удален');
        }
        
        // Также проверяем состояние instance item
        const instanceItem = statusData.data.find((item: any) => item.type === 'instance' && item.parent === ITEM_ID);
        if (instanceItem && instanceItem.data.state === 'deleted') {
          console.log('Instance item также удален');
        }
      } else {
        // Если managed item не найден - возможно он уже удален
        console.log('Managed item не найден в ответе - возможно удален');
        isDeleted = true;
      }

      // Дополнительная проверка - если все items в состоянии 'deleted'
      const allItemsDeleted = statusData.data.every((item: any) => item.data?.state === 'deleted');
      if (allItemsDeleted) {
        isDeleted = true;
        console.log('Все items удалены - кластер полностью удален');
      }

      // Проверяем статус заказа
      if (statusData.status === 'success' && isDeleted) {
        console.log('Заказ завершен и кластер удален');
        break;
      } else if (statusData.status === 'error') {
        console.log('Операция удаления завершилась ошибкой');
        break;
      }

      // Сбрасываем счетчик ретраев при успешном запросе
      retryCount = 0;

    } catch (error) {
      // Обрабатываем сетевые ошибки
      retryCount++;
      console.log(`Сетевая ошибка (попытка ${retryCount}/${maxRetries}):`, String(error));
      
      if (retryCount >= maxRetries) {
        console.log('Превышено количество попыток, прерываем операцию');
        break;
      }
      
      console.log('Повторная попытка через 10 секунд...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      // Пробуем обновить контекст API при сетевых ошибках
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  expect(isDeleted).toBe(true);
  console.log('Операция удаления кластера завершена успешно!');

  // Очищаем данные из testData после удаления
  testData.mysqlCluster = null;
  console.log('Данные кластера очищены из testData');
});