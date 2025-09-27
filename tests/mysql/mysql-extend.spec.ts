import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Увеличение диска MySQL', async () => {
  test.setTimeout(20 * 60 * 1000);
// пока оставим статичные данные, тут необходимо пробрасывать их предыдущего теста данные
  const ORDER_ID = '33b04421-bf2a-4b84-a1f9-3277f391bc8a';
  const ITEM_ID = '271fa8a0-0575-4903-83d3-f02303cab53c';
  
  let api = getAPIContext();

  // Проверка свежести токена
  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }
  
  // 1 Получаем детальную информацию о заказе
  const orderDetailResponse = await api.get(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${ORDER_ID}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // // Проверка структуры для отладки
  // console.log('Структура ответа:', Object.keys(orderDetail));
  // console.log('Есть ли data?', !!orderDetail.data);
  // console.log('Длина data:', orderDetail.data?.length);
  
  if (orderDetail.data && orderDetail.data.length > 0) {
    console.log('Первый элемент data:', orderDetail.data[0]);
  }
  
  // Берем актуальный размер из data (managed item)
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed');
  const CURRENT_SIZE = managedItem.data.config.boot_volume.size;
  
  console.log('Актуальный размер диска:', CURRENT_SIZE, 'GB');
  
  // Увеличиваем на 1GB
  const NEW_DISK_SIZE = CURRENT_SIZE + 1;
  
  console.log(`Увеличиваем диск с ${CURRENT_SIZE}GB до ${NEW_DISK_SIZE}GB`);

  // 2 Отправляем запрос на увеличение диска
  const response = await api.patch(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/extend_disk_size`,
    {
      data: {
        project_name: PROJECT_ID,
        id: ORDER_ID,
        item_id: ITEM_ID,
        order: {
          attrs: {
            new_size: NEW_DISK_SIZE,
          },
        },
      },
    },
  );

  console.log('Статус ответа:', response.status());
  
  if (response.status() !== 200) {
    const errorBody = await response.text();
    console.log('Ошибка от сервера:', errorBody);
    expect(response.status()).toBe(200);
  }

  console.log('Запрос отправлен успешно');

  // 3 Ждем завершения операции
  console.log('Ждем завершения операции...');

  const startTime = Date.now();
  const maxWaitTime = 15 * 60 * 1000;
  let isCompleted = false;

  while (!isCompleted && Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 60000));

    const statusResponse = await api.get(
      `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${ORDER_ID}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    if (statusData.status === 'success') {
      isCompleted = true;
      
      // Проверяем что размер изменился
      const updatedManagedItem = statusData.data.find((item: any) => item.type === 'managed');
      const finalSize = updatedManagedItem.data.config.boot_volume.size;
      
      console.log('Финальный размер диска:', finalSize, 'GB');
      expect(finalSize).toBe(NEW_DISK_SIZE);
      break;
    } else if (statusData.status === 'error') {
      console.log('Операция завершилась ошибкой');
      break;
    }
  }

  expect(isCompleted).toBe(true);
  console.log('Операция увеличения диска завершена успешно!');
});