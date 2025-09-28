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

test('Изменение настроек MySQL кластера', async () => {
  test.setTimeout(20 * 60 * 1000);

  // Статичные данные для отладки (НЕ УДАЛЯТЬ!)
  const ORDER_ID = '33b04421-bf2a-4b84-a1f9-3277f391bc8a';
  const ITEM_ID = '271fa8a0-0575-4903-83d3-f02303cab53c';
  const clusterName =  "mysql-vm-9j0k"
  
//   if (!testData.mysqlCluster) {
//     console.log('Кластер не создан, пропускаем тест');
//     test.skip();
//     return;
//   }
  
//   const { orderId: ORDER_ID, itemId: ITEM_ID, clusterName } = testData.mysqlCluster;
  
//   console.log('Начинаем изменение настроек для кластера:', clusterName);
//   console.log('Используем данные:', { ORDER_ID, ITEM_ID });

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
  
  // Ищем managed item чтобы получить текущие настройки
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item в заказе');
  }

   // Извлекаем текущие значения из конфигурации кластера
  const currentClusterDescription = managedItem.data.config.service?.description;
  const currentMysqlVersion = managedItem.data.config.mysql_version;

//   для отладки
//   console.log('Текущее описание кластера:', currentClusterDescription);
//   console.log('Текущая версия MySQL:', currentMysqlVersion);
//   console.log('Текущие настройки MySQL:', currentSettings);


  // Генерируем новые настройки
  const newMaxUserConnections = Math.floor(Math.random() * 900) + 100; // от 100 до 1000

  // Изменяем настройки кластера
  const changeSettingsPayload = {
    project_name: PROJECT_ID,
    id: ORDER_ID,
    item_id: ITEM_ID,
    order: {
      attrs: {
        cluster_description: currentClusterDescription,
        mysql_version: currentMysqlVersion,
        parameters: {
          max_user_connections: newMaxUserConnections
        }
      }
    }
  };

  console.log(`Устанавливаем max_user_connections: ${newMaxUserConnections}`);

  const changeSettingsResponse = await api.patch(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/edit_mysql_vm_settings`,
    { data: changeSettingsPayload }
  );

  console.log('Статус ответа на изменение настроек:', changeSettingsResponse.status());

  if (changeSettingsResponse.status() !== 200) {
    const errorBody = await changeSettingsResponse.text();
    console.log('Ошибка от сервера:', errorBody);
    expect(changeSettingsResponse.status()).toBe(200);
  }

  console.log('Запрос на изменение настроек отправлен успешно');

  // Ждем завершения операции
  console.log('Ждем завершения операции изменения настроек...');

  const startTime = Date.now();
  const maxWaitTime = 15 * 60 * 1000;
  let isCompleted = false;
  let retryCount = 0;
  const maxRetries = 3;

  while (!isCompleted && Date.now() - startTime < maxWaitTime) {
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
        isCompleted = true;
      }

      // Проверяем что настройки изменились в конфигурации
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
      
      if (currentManagedItem) {
        const updatedSettings = currentManagedItem.data.config.settings?.mysqld || {};
        const updatedMaxConnections = updatedSettings.max_user_connections;
        
        if (updatedMaxConnections === newMaxUserConnections) {
          isCompleted = true;
          console.log('Настройки изменены в конфигурации');
        }
      }

      if (statusData.status === 'success' && isCompleted) {
        // Финальная проверка конфигурации
        const finalManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
        const finalSettings = finalManagedItem.data.config.settings?.mysqld || {};
        const finalMaxConnections = finalSettings.max_user_connections;
        
        console.log('Финальное значение max_user_connections:', finalMaxConnections);
        
        expect(finalMaxConnections).toBe(newMaxUserConnections);
        break;
      } else if (statusData.status === 'error') {
        console.log('Операция завершилась ошибкой');
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

  expect(isCompleted).toBe(true);
  console.log('Операция изменения настроек завершена успешно!');

  // Финальная проверка статуса кластера после изменения настроек
  console.log('Проверяем статус кластера после изменения настроек...');
  await checkClusterStatus(api, PROJECT_ID, ORDER_ID, ITEM_ID);
});