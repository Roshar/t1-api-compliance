import { OrderDataFactory } from '../data/OrderDataFactory';
import { getAPIContext, refreshAPIContext, shouldRefreshToken } from './api-context';
import { checkClusterStatus } from './cluster-status';
import { generateRandomUsername, generateRandomPassword, generateRandomDatabaseName } from '../common/test-data-generators';

const PROJECT_ID = process.env.PROJECT_ID!;

export async function createMySQLCluster() {
  const orderData = OrderDataFactory.createOrderData('mysql-standalone');
  const body = orderData.buildOrderBody();
  const clusterName = body.order.attrs.cluster_name;

  console.log('Создаем заказ:', clusterName);

  let api = getAPIContext();
  
  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  const createResponse = await api.post(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders`,
    { data: body },
  );

  if (createResponse.status() !== 200) {
    throw new Error(`Failed to create order: ${await createResponse.text()}`);
  }

  const createResult = await createResponse.json();
  const orderId = createResult[0].id;

  console.log('Заказ создан, ID:', orderId);

  let isDeployed = false;
  const startTime = Date.now();
  const maxWaitTime = 25 * 60 * 1000;
  let checkCount = 0;

  while (!isDeployed && Date.now() - startTime < maxWaitTime) {
    checkCount++;
  
    await new Promise((resolve) => setTimeout(resolve, 60000));

    if (checkCount % 10 === 0 && shouldRefreshToken()) {
      console.log('Обновляем токен...');
      await refreshAPIContext();
      api = getAPIContext();
    }
      console.log('Процесс развертывания...')

    try {
      const listResponse = await api.get(
        `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders?page=1&per_page=5`
      );

      if (listResponse.status() === 200) {
        const listResult = await listResponse.json();
        const ourOrder = listResult.list.find((order: any) => order.id === orderId);

        if (ourOrder && ourOrder.status === 'success') {
          isDeployed = true;
          console.log('Кластер развернут!');

          const detailResponse = await api.get(
            `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
          );
          const detailData = await detailResponse.json();
          
          const managedItem = detailData.data.find((item: any) => item.type === 'managed');
          const itemId = managedItem.item_id;
          
         console.log('Кластер создан:', { orderId, itemId });
         return { orderId, itemId, clusterName };
          

        }
      }
    } catch (error) {
      console.log('Ошибка:', String(error));
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  throw new Error('Кластер упал по таймауту');
}

export async function extendMySQLDisk(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }
  
  const orderDetailResponse = await api.get(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed');
  const CURRENT_SIZE = managedItem.data.config.boot_volume.size;
  
  console.log('Актуальный размер диска:', CURRENT_SIZE, 'GB');
  
  const NEW_DISK_SIZE = CURRENT_SIZE + 1;
  
  console.log(`Увеличиваем диск с ${CURRENT_SIZE}GB до ${NEW_DISK_SIZE}GB`);

  await checkClusterStatus(api, PROJECT_ID, orderId, itemId);

  const response = await api.patch(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/extend_disk_size`,
    {
      data: {
        project_name: PROJECT_ID,
        id: orderId,
        item_id: itemId,
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
    throw new Error(`Действие на увеличения диска упало: ${errorBody}`);
  }

  console.log('Запрос отправлен успешно');

  console.log('Ждем завершения операции...');

  const startTime = Date.now();
  const maxWaitTime = 15 * 60 * 1000;
  let isCompleted = false;

  while (!isCompleted && Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 60000));

    const statusResponse = await api.get(
      `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    if (statusData.status === 'success') {
      isCompleted = true;
      
      const updatedManagedItem = statusData.data.find((item: any) => item.type === 'managed');
      const finalSize = updatedManagedItem.data.config.boot_volume.size;
      
      console.log('Финальный размер диска:', finalSize, 'GB');
      
      if (finalSize !== NEW_DISK_SIZE) {
        throw new Error(`Ожидаемый размер диска ${NEW_DISK_SIZE}GB, но фактически ${finalSize}GB`);
      }
      
      break;
    } else if (statusData.status === 'error') {
      throw new Error('Увеличение размера диска упало');
    }
  }

  if (!isCompleted) {
    throw new Error('Увеличение размера диска упало по таймауту');
  }

  console.log('Операция увеличения диска завершена успешно!');
}

export async function addPublicIp(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId);
  
  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы проверить текущее состояние Public IP
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item в заказе');
  }

  const currentPublicIpStatus = managedItem.data.config.public_ip;
  console.log('Текущий статус Public IP:', currentPublicIpStatus);

  // Если Public IP уже подключен - просто возвращаемся
  if (currentPublicIpStatus === true) {
    console.log('Public IP уже подключен, пропускаем операцию');
    return; // просто выходим, не бросаем ошибку
  }

  console.log('Подключаем Public IP...');

  // Запускаем действие по подключению public ip 
  const publicIpPayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
    order: {
      attrs: {
        bandwidth: 100  
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
    throw new Error(`Ожидался статус 200, но получен ${addPublicIpResponse.status()}: ${errorBody}`);
  }

  console.log('Запрос на подключение Public IP отправлен успешно');

  // Ждем завершения операции подключения Public IP
  console.log('Ждем завершения операции подключения public ip...');

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
      `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что Public IP появился в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
    
    if (currentManagedItem && currentManagedItem.data.config.public_ip === true) {
      isCompleted = true;
      console.log('Public IP успешно подключен');
      
      // Финальная проверка
      const publicIpEnabled = currentManagedItem.data.config.public_ip;
      const bandwidth = currentManagedItem.data.config.bandwidth;
      
      console.log('Public IP включен:', publicIpEnabled);
      console.log('Ширина канала:', bandwidth, 'Mbps');

      if (!publicIpEnabled) {
        throw new Error(`Public IP не подключен, хотя операция завершена. Статус: ${publicIpEnabled}`);
      }
      break;
    }

    if (statusData.status === 'error') {
      throw new Error('Операция подключения Public IP завершилась ошибкой');
    }
  }

  if (!isCompleted) {
    throw new Error('Операция подключения Public IP не завершилась за отведенное время');
  }

  console.log('Операция подключения Public IP завершена успешно!');
}

export async function changeBandwidth(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId);
  
  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );

  const orderDetail = await orderDetailResponse.json();
    
  // Ищем managed item чтобы проверить текущее состояние
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
    throw new Error('Public IP не подключен, невозможно изменить ширину канала');
  }

  console.log('Public IP подключен, меняем ширину канала');

  // Генерируем случайную ширину канала от 200 до 10000 Mbps
  const availableBandwidths = [200, 500, 1000, 2000, 5000, 10000];
  const NEW_BANDWIDTH = availableBandwidths[Math.floor(Math.random() * availableBandwidths.length)];
  
  // Проверяем что новая ширина канала отличается от текущей
  if (currentBandwidth === NEW_BANDWIDTH) {
    console.log(`Ширина канала уже установлена на ${NEW_BANDWIDTH}Mbps, выбираем другую`);
    // Выбираем другую ширину канала
    const otherBandwidths = availableBandwidths.filter(bw => bw !== NEW_BANDWIDTH);
    if (otherBandwidths.length === 0) {
      throw new Error('Нет доступных значений ширины канала для изменения');
    }
    NEW_BANDWIDTH = otherBandwidths[Math.floor(Math.random() * otherBandwidths.length)];
  }

  console.log(`Меняем ширину канала с ${currentBandwidth}Mbps на ${NEW_BANDWIDTH}Mbps`);

  // Изменяем ширину канала
  const changeBandwidthPayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
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
    throw new Error(`Ожидался статус 200, но получен ${changeBandwidthResponse.status()}: ${errorBody}`);
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
      `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что ширина канала изменилась в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
    
    if (currentManagedItem && currentManagedItem.data.config.bandwidth === NEW_BANDWIDTH) {
      isCompleted = true;
      console.log('Ширина канала успешно изменена');
      
      // Финальная проверка
      const finalBandwidth = currentManagedItem.data.config.bandwidth;
      const publicIpEnabled = currentManagedItem.data.config.public_ip;
      
      console.log('Финальная ширина канала:', finalBandwidth, 'Mbps');
      console.log('Public IP включен:', publicIpEnabled);
      
      if (finalBandwidth !== NEW_BANDWIDTH) {
        throw new Error(`Ожидалась ширина канала ${NEW_BANDWIDTH}Mbps, но получена ${finalBandwidth}Mbps`);
      }
      
      if (!publicIpEnabled) {
        throw new Error('Public IP отключился после изменения ширины канала');
      }
      
      break;
    }

    if (statusData.status === 'error') {
      throw new Error('Операция изменения ширины канала завершилась ошибкой');
    }
  }

  if (!isCompleted) {
    throw new Error('Операция изменения ширины канала не завершилась за отведенное время');
  }

  console.log('Операция изменения ширины канала завершена успешно!');
  return NEW_BANDWIDTH; // Возвращаем новое значение для информации
}

export async function disablePublicIp(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId);

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
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
    console.log('Public IP уже отключен, пропускаем операцию');
    return; // Просто выходим, не бросаем ошибку
  }

  console.log('Public IP подключен, начинаем отключение');

  // Отключаем Public IP
  const disablePublicIpPayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
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
    throw new Error(`Ожидался статус 200, но получен ${disablePublicIpResponse.status()}: ${errorBody}`);
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
      `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что Public IP пропал из конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
    
    if (currentManagedItem && currentManagedItem.data.config.public_ip === false) {
      isCompleted = true;
      console.log('Public IP успешно отключен');
      
      // Финальная проверка
      const publicIpEnabled = currentManagedItem.data.config.public_ip;
      console.log('Public IP включен:', publicIpEnabled);
      
      if (publicIpEnabled !== false) {
        throw new Error(`Public IP должен быть отключен, но статус: ${publicIpEnabled}`);
      }
      
      break;
    }

    if (statusData.status === 'error') {
      throw new Error('Операция отключения Public IP завершилась ошибкой');
    }
  }

  if (!isCompleted) {
    throw new Error('Операция отключения Public IP не завершилась за отведенное время');
  }

  console.log('Операция отключения Public IP завершена успешно!');
}

export async function createMySQLUser(orderId: string, itemId: string, clusterName: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId);

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
    throw new Error(`Ожидался статус 202, но получен ${createUserResponse.status()}: ${errorBody}`);
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
        
        // Если ошибка сервера, пробуем еще раз
        if (commandResponse.status() >= 500 && retryCount < maxRetries) {
          retryCount++;
          console.log(`Ошибка сервера, повторная попытка ${retryCount}/${maxRetries}: ${errorBody}`);
          await new Promise((resolve) => setTimeout(resolve, 10000));
          continue;
        }
        
        // Если клиентская ошибка, выходим
        throw new Error(`Ошибка при проверке статуса команды: ${commandResponse.status()} - ${errorBody}`);
      }

      const commandData = await commandResponse.json();
      
      const secondsPassed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[${secondsPassed} сек] Статус команды: ${commandData.status}`);

      if (commandData.status === 'success') {
        isCompleted = true;
        console.log('Пользователь успешно создан');
        break;
      } else if (commandData.status === 'failed') {
        throw new Error(`Создание пользователя завершилось ошибкой: ${commandData.error || 'Неизвестная ошибка'}`);
      }

      // Сбрасываем счетчик ретраев при успешном запросе
      retryCount = 0;

    } catch (error) {
      // Обрабатываем сетевые ошибки
      retryCount++;
      console.log(`Сетевая ошибка (попытка ${retryCount}/${maxRetries}):`, String(error));
      
      if (retryCount >= maxRetries) {
        throw new Error('Превышено количество попыток из-за сетевых ошибок');
      }
      
      console.log('Повторная попытка через 10 секунд...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      // Пробуем обновить контекст API при сетевых ошибках
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  if (!isCompleted) {
    throw new Error('Создание пользователя не завершилось за отведенное время');
  }

  console.log('Операция создания пользователя завершена успешно!');
  return username; // Возвращаем имя созданного пользователя
}

export async function createMySQLDatabase(orderId: string, itemId: string, clusterName: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId);

  // Генерируем случайное название для БД
  const dbname = generateRandomDatabaseName(); // Используем специализированную функцию если есть, или generateRandomUsername()
 
  console.log('Создаем БД с именем:', dbname);

  // Создаем базу данных
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
    throw new Error(`Ожидался статус 202, но получен ${createDbResponse.status()}: ${errorBody}`);
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
        
        // Если ошибка сервера, пробуем еще раз
        if (commandResponse.status() >= 500 && retryCount < maxRetries) {
          retryCount++;
          console.log(`Ошибка сервера, повторная попытка ${retryCount}/${maxRetries}: ${errorBody}`);
          await new Promise((resolve) => setTimeout(resolve, 10000));
          continue;
        }
        
        // Если клиентская ошибка, выходим
        throw new Error(`Ошибка при проверке статуса команды: ${commandResponse.status()} - ${errorBody}`);
      }

      const commandData = await commandResponse.json();
      
      const secondsPassed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[${secondsPassed} сек] Статус команды: ${commandData.status}`);

      if (commandData.status === 'success') {
        isCompleted = true;
        console.log('База данных успешно создана');
        break;
      } else if (commandData.status === 'failed') {
        throw new Error(`Создание базы данных завершилось ошибкой: ${commandData.error || 'Неизвестная ошибка'}`);
      }

      // Сбрасываем счетчик ретраев при успешном запросе
      retryCount = 0;

    } catch (error) {
      // Обрабатываем сетевые ошибки
      retryCount++;
      console.log(`Сетевая ошибка (попытка ${retryCount}/${maxRetries}):`, String(error));
      
      if (retryCount >= maxRetries) {
        throw new Error('Превышено количество попыток из-за сетевых ошибок');
      }
      
      console.log('Повторная попытка через 10 секунд...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      // Пробуем обновить контекст API при сетевых ошибках
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  if (!isCompleted) {
    throw new Error('Создание базы данных не завершилось за отведенное время');
  }

  console.log('Операция создания базы данных завершена успешно!');
  return dbname; // Возвращаем имя созданной базы данных
}

export async function editMySQLSettings(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId);

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
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
  const currentSettings = managedItem.data.config.settings?.mysqld || {};
  const currentMaxConnections = currentSettings.max_user_connections;

  console.log('Текущее значение max_user_connections:', currentMaxConnections);

  // Генерируем новые настройки
  let newMaxUserConnections = Math.floor(Math.random() * 900) + 100; // от 100 до 1000

  // Проверяем что новое значение отличается от текущего
  if (currentMaxConnections === newMaxUserConnections) {
    console.log(`Текущее значение ${currentMaxConnections} совпадает с новым, выбираем другое значение`);
    // Выбираем другое значение
    const alternativeConnections = [150, 200, 300, 500, 800];
    const availableOptions = alternativeConnections.filter(val => val !== currentMaxConnections);
    if (availableOptions.length === 0) {
      throw new Error('Нет доступных значений для изменения max_user_connections');
    }
    newMaxUserConnections = availableOptions[Math.floor(Math.random() * availableOptions.length)];
  }

  console.log(`Устанавливаем max_user_connections: ${newMaxUserConnections}`);

  // Изменяем настройки кластера
  const changeSettingsPayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
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

  const changeSettingsResponse = await api.patch(
    `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/edit_mysql_vm_settings`,
    { data: changeSettingsPayload }
  );

  console.log('Статус ответа на изменение настроек:', changeSettingsResponse.status());

  if (changeSettingsResponse.status() !== 200) {
    const errorBody = await changeSettingsResponse.text();
    throw new Error(`Ожидался статус 200, но получен ${changeSettingsResponse.status()}: ${errorBody}`);
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
        `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что настройки изменились в конфигурации
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
      
      if (currentManagedItem) {
        const updatedSettings = currentManagedItem.data.config.settings?.mysqld || {};
        const updatedMaxConnections = updatedSettings.max_user_connections;
        
        if (updatedMaxConnections === newMaxUserConnections) {
          isCompleted = true;
          console.log('Настройки успешно изменены');
          
          // Финальная проверка
          console.log('Финальное значение max_user_connections:', updatedMaxConnections);
          
          if (updatedMaxConnections !== newMaxUserConnections) {
            throw new Error(`Ожидалось значение ${newMaxUserConnections}, но получено ${updatedMaxConnections}`);
          }
          
          break;
        }
      }

      if (statusData.status === 'error') {
        throw new Error('Операция изменения настроек завершилась ошибкой');
      }

      // Сбрасываем счетчик ретраев при успешном запросе
      retryCount = 0;

    } catch (error) {
      // Обрабатываем сетевые ошибки
      retryCount++;
      console.log(`Сетевая ошибка (попытка ${retryCount}/${maxRetries}):`, String(error));
      
      if (retryCount >= maxRetries) {
        throw new Error('Превышено количество попыток из-за сетевых ошибок');
      }
      
      console.log('Повторная попытка через 10 секунд...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      // Пробуем обновить контекст API при сетевых ошибках
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  if (!isCompleted) {
    throw new Error('Изменение настроек не завершилось за отведенное время');
  }

  console.log('Операция изменения настроек завершена успешно!');

  // Финальная проверка статуса кластера после изменения настроек
  console.log('Проверяем статус кластера после изменения настроек...');
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId);

  return newMaxUserConnections; // Возвращаем новое значение для информации
}

export async function deleteMySQLCluster(orderId: string, itemId: string, clusterName: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  console.log('Начинаем удаление кластера:', clusterName);

  // Отправляем запрос на удаление кластера
  const deleteClusterPayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
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
    throw new Error(`Ожидался статус 200, но получен ${deleteResponse.status()}: ${errorBody}`);
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
        `/mysql-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Ищем managed item и проверяем его состояние
      const managedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
      
      if (managedItem) {
        const itemState = managedItem.data.state;
        console.log(`Состояние managed item: ${itemState}`);
        
        // Если managed item в состоянии 'deleted' - кластер удален
        if (itemState === 'deleted') {
          isDeleted = true;
          console.log('Managed item удален - кластер удален');
          break;
        }
      } else {
        // Если managed item не найден - он уже удален
        console.log('Managed item не найден в ответе - кластер удален');
        isDeleted = true;
        break;
      }

      // Дополнительная проверка - если все items в состоянии 'deleted'
      const allItemsDeleted = statusData.data.every((item: any) => item.data?.state === 'deleted');
      if (allItemsDeleted) {
        isDeleted = true;
        console.log('Все items удалены - кластер полностью удален');
        break;
      }

      if (statusData.status === 'error') {
        throw new Error('Операция удаления завершилась ошибкой');
      }

      // Сбрасываем счетчик ретраев при успешном запросе
      retryCount = 0;

    } catch (error) {
      // Обрабатываем сетевые ошибки
      retryCount++;
      console.log(`Сетевая ошибка (попытка ${retryCount}/${maxRetries}):`, String(error));
      
      if (retryCount >= maxRetries) {
        throw new Error('Превышено количество попыток из-за сетевых ошибок');
      }
      
      console.log('Повторная попытка через 10 секунд...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      // Пробуем обновить контекст API при сетевых ошибках
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  if (!isDeleted) {
    throw new Error('Удаление кластера не завершилось за отведенное время');
  }

  console.log('Операция удаления кластера завершена успешно!');
  return true; // Возвращаем true для подтверждения удаления
}