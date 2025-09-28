import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext, getAPIContext, refreshAPIContext, shouldRefreshToken } from '../common/api-context';
import { testData } from '../common/test-data';
import { checkClusterStatus } from '../common/cluster-status';
import { generateRandomUsername, generateRandomPassword } from '../common/test-data-generators';

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Создание базы данных в MySQL', async () => {
  test.setTimeout(10 * 60 * 1000); 

// Статичные данные для отладки (НЕ УДАЛЯТЬ!)
  const ORDER_ID = '33b04421-bf2a-4b84-a1f9-3277f391bc8a';
  const ITEM_ID = '271fa8a0-0575-4903-83d3-f02303cab53c';
  const clusterName =  "mysql-vm-9j0k"
  
//   if (!testData.mysqlCluster) {
//     console.log('Кластер не создан, пропускаем тест');
//     test.skip();
//     return;
//   }
  
//   const { orderId: ORDER_ID, itemId: ITEM_ID } = testData.mysqlCluster;
  
//   console.log('Начинаем создание БД для кластера:');
//   console.log('Используем данные:', { ORDER_ID, ITEM_ID });

  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, ORDER_ID, ITEM_ID);

  // Генерируем случайное название для БД
  const dbname = generateRandomUsername();
 
  console.log('Создаем БД с именем:', dbname);


  // Создаем юзера
  const createDbPayload = {
    name: dbname,
    character_set: "utf8mb3",
    collation: "utf8mb3_general_ci",
    encryption: "NO"
  };

  const createDbResponse = await api.post(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/services/${clusterName}/databases`,
    { data: createDbPayload }
  );

  console.log('Статус ответа на создание БД:', createDbResponse.status());

  if (createDbResponse.status() !== 202) {
    const errorBody = await createDbResponse.text();
    console.log('Ошибка от сервера:', errorBody);
    expect(createDbResponse.status()).toBe(202);
  }

  const createDbData = await createDbResponse.json();
  console.log('Команда создания БД отправлена, URL:', createDbData.url);

  // Извлекаем ID команды из URL
  const commandId = createDbData.url.split('/').pop();
  console.log('Command ID для проверки статуса:', commandId);

  // Ждем завершения операции создания БД
  console.log('Ждем завершения операции создания БД...');

  const startTime = Date.now();
  const maxWaitTime = 5 * 60 * 1000; 
  let isCompleted = false;
  let retryCount = 0;
  const maxRetries = 3;

  while (!isCompleted && Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 30000));

    if (shouldRefreshToken()) {
      console.log('Обновляем токен...');
      await refreshAPIContext();
      api = getAPIContext();
    }

    try {
      const commandResponse = await api.get(
        `/mysql-manager/api/v1/projects/${PROJECT_ID}/commands/${commandId}`
      );

      if (commandResponse.status() !== 200) {
        const errorBody = await commandResponse.text();
        console.log('Ошибка при проверке статуса команды:', errorBody);
        
        // Если ошибка сервера, пробуем еще раз
        if (commandResponse.status() >= 500 && retryCount < maxRetries) {
          retryCount++;
          console.log(`Повторная попытка ${retryCount}/${maxRetries} через 10 секунд...`);
          await new Promise((resolve) => setTimeout(resolve, 10000));
          continue;
        }
        
        // Если клиентская ошибка, выходим
        if (commandResponse.status() >= 400 && commandResponse.status() < 500) {
          console.log('Клиентская ошибка, прерываем операцию');
          break;
        }
        
        continue;
      }

      const commandData = await commandResponse.json();
      
      const secondsPassed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[${secondsPassed} сек] Статус команды: ${commandData.status}`);

      if (commandData.status === 'success') {
        isCompleted = true;
        console.log('База данных успешно создана');
        break;
      } else if (commandData.status === 'failed') {
        console.log('Создание БД завершилось ошибкой');
        break;
      }

      // Сбрасываем счетчик ретраев при успешном запросе
      retryCount = 0;

    } catch (error) {
      // Обрабатываем сетевые ошибки (таймауты, хэнгапы и прочее.)
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
  console.log('Операция создания базы данных завершена успешно!');
});