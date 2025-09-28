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

test('Подключение Public IP к MySQL кластеру', async () => {
  test.setTimeout(20 * 60 * 1000); 

  // Статичные данные для отладки (НЕ УДАЛЯТЬ!)
  const ORDER_ID = '33b04421-bf2a-4b84-a1f9-3277f391bc8a';
  const ITEM_ID = '271fa8a0-0575-4903-83d3-f02303cab53c';
  
//   if (!testData.mysqlCluster) {
//     console.log('Кластер не создан, пропускаем тест');
//     test.skip();
//     return;
//   }
  
//   const { orderId: ORDER_ID, itemId: ITEM_ID, clusterName } = testData.mysqlCluster;
  
  console.log('Начинаем подключение Public IP для кластера:');
  console.log('Используем данные:', { ORDER_ID, ITEM_ID });

  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }


// Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, ORDER_ID, ITEM_ID);

// Запускаем действие по подключению public ip 
  const publicIpPayload = {
    project_name: PROJECT_ID,
    id: ORDER_ID,
    item_id: ITEM_ID,
    order: {
      attrs: {
        bandwidth: 100  // 100 Mbps
      }
    }
  };

  const addPublicIpResponse = await api.patch(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/add_fip_managed_mysql`,
    { data: publicIpPayload }
  );

  console.log('Статус ответа на подключение Public IP:', addPublicIpResponse.status());

  if (addPublicIpResponse.status() !== 200) {
    const errorBody = await addPublicIpResponse.text();
    console.log('Ошибка от сервера:', errorBody);
    expect(addPublicIpResponse.status()).toBe(200);
  }

  console.log('Запрос на подключение Public IP отправлен успешно');

  // Шаг 5: Ждем завершения операции подключения Public IP
  console.log('Ждем завершения операции подключения public ip...');

  const startTime = Date.now();
  const maxWaitTime = 15 * 60 * 1000; // 15 минут максимум
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

    // Проверяем что Public IP появился в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
    
    if (currentManagedItem && currentManagedItem.data.config.public_ip === true) {
      isCompleted = true;
      console.log('Public IP обнаружен в конфигурации');
    }

    if (statusData.status === 'success' && isCompleted) {
      // Финальная проверка конфигурации
      const publicIpEnabled = currentManagedItem.data.config.public_ip;
      const bandwidth = currentManagedItem.data.config.bandwidth;
      
      console.log('Public IP включен:', publicIpEnabled);
      console.log('Ширина канала:', bandwidth, 'Mbps');
      
      expect(publicIpEnabled).toBe(true);
      expect(bandwidth).toBe(100);
      break;
    } else if (statusData.status === 'error') {
      console.log('Операция завершилась ошибкой');
      break;
    }
  }

  expect(isCompleted).toBe(true);
  console.log('Операция подключения Public IP завершена успешно!');
});