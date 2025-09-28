import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';
import { testData } from '../common/test-data';
import { checkClusterStatus } from '../common/cluster-status';

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Отключение Public IP от MySQL кластера', async () => {
  test.setTimeout(20 * 60 * 1000);
  
  // Статичные данные для отладки (НЕ УДАЛЯТЬ!)
  const ORDER_ID = '33b04421-bf2a-4b84-a1f9-3277f391bc8a';
  const ITEM_ID = '271fa8a0-0575-4903-83d3-f02303cab53c';
  
//   if (!testData.mysqlCluster) {
//     console.log('Кластер не создан, пропускаем тест');
//     test.skip();
//     return;
//   }
  
//   const { orderId: ORDER_ID, itemId: ITEM_ID } = testData.mysqlCluster;
  
  console.log('Начинаем отключение Public IP для кластера:');
  console.log('Используем данные:', { ORDER_ID, ITEM_ID });

  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, ORDER_ID, ITEM_ID);

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${ORDER_ID}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы проверить текущее состояние Public IP
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item в заказе');
  }

  const currentPublicIpStatus = managedItem.data.config.public_ip;
  console.log('Текущий статус Public IP:', currentPublicIpStatus);

  // Проверяем что Public IP изначально подключен
  if (currentPublicIpStatus === false) {
    console.log('Public IP уже отключен, пропускаем тест');
    test.skip();
    return;
  }

  expect(currentPublicIpStatus).toBe(true);
  console.log('Public IP подключен, можно отключать');

  // Отключаем Public IP
  const disablePublicIpPayload = {
    project_name: PROJECT_ID,
    id: ORDER_ID,
    item_id: ITEM_ID,
    order: {
      attrs: {}
    }
  };

  const disablePublicIpResponse = await api.patch(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/disable_fip_managed_mysql`,
    { data: disablePublicIpPayload }
  );

  console.log('Статус ответа на отключение Public IP:', disablePublicIpResponse.status());

  if (disablePublicIpResponse.status() !== 200) {
    const errorBody = await disablePublicIpResponse.text();
    console.log('Ошибка от сервера:', errorBody);
    expect(disablePublicIpResponse.status()).toBe(200);
  }

  console.log('Запрос на отключение Public IP отправлен успешно');

  // Ждем завершения операции
  console.log('Ждем завершения операции отключения Public IP...');

  const startTime = Date.now();
  const maxWaitTime = 15 * 60 * 1000;
  let isCompleted = false;

  while (!isCompleted && Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 60000));

    if (shouldRefreshToken()) {
      console.log('Обновляем токен...');
      await refreshAPIContext();
      api = getAPIContext();
    }

    const statusResponse = await api.get(
      `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${ORDER_ID}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем статус последнего действия
    if (statusData.last_action && statusData.last_action.status === 'success') {
      isCompleted = true;
    }

    // Проверяем что Public IP пропал из конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
    
    if (currentManagedItem && currentManagedItem.data.config.public_ip === false) {
      isCompleted = true;
      console.log('Public IP отключен в конфигурации');
    }

    if (statusData.status === 'success' && isCompleted) {
      const publicIpEnabled = currentManagedItem.data.config.public_ip;
      
      console.log('Public IP включен:', publicIpEnabled);
      
      expect(publicIpEnabled).toBe(false);
      break;
    } else if (statusData.status === 'error') {
      console.log('Операция завершилась ошибкой');
      break;
    }
  }

  expect(isCompleted).toBe(true);
  console.log('Операция отключения Public IP завершена успешно!');
});