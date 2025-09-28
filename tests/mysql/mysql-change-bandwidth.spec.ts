import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';
import { testData } from '../common/test-data';
import { checkClusterStatus } from '../common/cluster-status';
import { getRandomBandwidth } from '../common/test-data-generators';


const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Изменение ширины канала Public IP MySQL кластера', async () => {
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
  
  console.log('Начинаем изменение ширины канала Public IP для кластера:');
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
  const currentBandwidth = managedItem.data.config.bandwidth;
  
  console.log('Текущий статус Public IP:', currentPublicIpStatus);
  console.log('Текущая ширина канала:', currentBandwidth, 'Mbps');

  // Проверяем что Public IP подключен
  if (currentPublicIpStatus !== true) {
    console.log('Public IP не подключен, пропускаем тест');
    test.skip();
    return;
  }

  expect(currentPublicIpStatus).toBe(true);
  console.log('Public IP подключен, меняем ширину');

  // Генерируем случайную ширину канала от 200 до 10000 Mbps
  const NEW_BANDWIDTH = getRandomBandwidth(200, 10000);
  
  // Проверяем что новая ширина канала отличается от текущей
  if (currentBandwidth === NEW_BANDWIDTH) {
    console.log('Ширина канала уже установлена на', NEW_BANDWIDTH, 'Mbps, пропускаем тест');
    test.skip();
    return;
  }

  console.log(`Меняем ширину канала с ${currentBandwidth}Mbps на ${NEW_BANDWIDTH}Mbps`);

  // Изменяем ширину канала
  const changeBandwidthPayload = {
    project_name: PROJECT_ID,
    id: ORDER_ID,
    item_id: ITEM_ID,
    order: {
      attrs: {
        bandwidth: NEW_BANDWIDTH
      }
    }
  };

  const changeBandwidthResponse = await api.patch(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/change_bandwidth_managed`,
    { data: changeBandwidthPayload }
  );

  console.log('Статус ответа на изменение ширины канала:', changeBandwidthResponse.status());

  if (changeBandwidthResponse.status() !== 200) {
    const errorBody = await changeBandwidthResponse.text();
    console.log('Ошибка от сервера:', errorBody);
    expect(changeBandwidthResponse.status()).toBe(200);
  }

  console.log('Запрос на изменение ширины канала отправлен успешно');

  // Ждем завершения операции
  console.log('Ждем завершения операции изменения ширины канала...');

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

    // Проверяем что ширина канала изменилась в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
    
    if (currentManagedItem && currentManagedItem.data.config.bandwidth === NEW_BANDWIDTH) {
      isCompleted = true;
      console.log('Ширина канала изменена в конфигурации');
    }

    if (statusData.status === 'success' && isCompleted) {
      const finalBandwidth = currentManagedItem.data.config.bandwidth;
      const publicIpEnabled = currentManagedItem.data.config.public_ip;
      
      console.log('Финальная ширина канала:', finalBandwidth, 'Mbps');
      console.log('Public IP включен:', publicIpEnabled);
      
      expect(finalBandwidth).toBe(NEW_BANDWIDTH);
      expect(publicIpEnabled).toBe(true);
      break;
    } else if (statusData.status === 'error') {
      console.log('Операция завершилась ошибкой');
      break;
    }
  }

  expect(isCompleted).toBe(true);
  console.log('Операция изменения ширины канала завершена успешно!');
});