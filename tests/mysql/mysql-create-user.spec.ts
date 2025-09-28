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

test('Создание пользователя MySQL', async () => {
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
  
//   console.log('Начинаем создание пользователя для кластера:');
//   console.log('Используем данные:', { ORDER_ID, ITEM_ID });

  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, ORDER_ID, ITEM_ID);

  // Генерируем случайные данные пользователя
  const username = generateRandomUsername();
  const password = generateRandomPassword();
  
  console.log('Создаем пользователя с именем:', username);
  console.log('Длина пароля:', password.length, 'символов');

  // Создаем юзера
  const createUserPayload = {
    name: username,
    password: password,
    privileges: "ALL",
    db_table: "*.*"
  };

  const createUserResponse = await api.post(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/services/${clusterName}/users`,
    { data: createUserPayload }
  );

  console.log('Статус ответа на создание пользователя:', createUserResponse.status());

  if (createUserResponse.status() !== 202) {
    const errorBody = await createUserResponse.text();
    console.log('Ошибка от сервера:', errorBody);
    expect(createUserResponse.status()).toBe(202);
  }

  const createUserData = await createUserResponse.json();
  console.log('Команда создания пользователя отправлена, URL:', createUserData.url);

  // Извлекаем ID команды из URL
  const commandId = createUserData.url.split('/').pop();
  console.log('Command ID для проверки статуса:', commandId);

  // Ждем завершения операции создания пользователя
  console.log('Ждем завершения операции создания пользователя...');

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
        console.log('Пользователь успешно создан');
        break;
      } else if (commandData.status === 'failed') {
        console.log('Создание пользователя завершилось ошибкой');
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
  console.log('Операция создания пользователя завершена успешно!');
});