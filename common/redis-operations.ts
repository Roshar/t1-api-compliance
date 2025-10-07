import { OrderDataFactory } from '../data/OrderDataFactory';
import { getAPIContext, refreshAPIContext, shouldRefreshToken } from './api-context';
import { checkClusterStatus } from './cluster-status';
import { generateRandomUsername, generateRandomPassword } from '../common/test-data-generators';
import {ProductType} from '../data/OrderDataFactory'

const PROJECT_ID = process.env.PROJECT_ID!;

export async function createCluster(productType: string = 'redis-standalone') {
  const orderData = OrderDataFactory.createOrderData(productType as ProductType);
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
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders`,
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
        `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders?page=1&per_page=5`
      );

      if (listResponse.status() === 200) {
        const listResult = await listResponse.json();
        const ourOrder = listResult.list.find((order: any) => order.id === orderId);

        if (ourOrder && ourOrder.status === 'success') {
          isDeployed = true;
          console.log('Кластер развернут!');

          const detailResponse = await api.get(
            `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
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

// redis-operations.ts
export async function extendDisk(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }
  
  // Получаем информацию о заказе
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item для Redis
  const managedItem = orderDetail.data.find((item: any) => 
    item.type === 'managed' && item.provider === 'redis_vm'
  );
  
  if (!managedItem) {
    throw new Error('Не найден managed item для Redis в заказе');
  }
  
  const CURRENT_SIZE = managedItem.data.config.boot_volume.size;
  
  console.log('Актуальный размер диска:', CURRENT_SIZE, 'GB');
  
  const NEW_DISK_SIZE = CURRENT_SIZE + 1;
  
  console.log(`Увеличиваем диск с ${CURRENT_SIZE}GB до ${NEW_DISK_SIZE}GB`);

  // Используем универсальную проверку статуса с указанием типа продукта
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  const response = await api.patch(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/extend_disk_size`,
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
      `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    if (statusData.status === 'success') {
      isCompleted = true;
      
      // Ищем обновленный managed item для Redis
      const updatedManagedItem = statusData.data.find((item: any) => 
        item.type === 'managed' && item.provider === 'redis_vm'
      );
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');
  
  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы проверить текущее состояние Public IP
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
  
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
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/add_fip_managed_redis`,
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
      `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что Public IP появился в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
    
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');
  
  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );

  const orderDetail = await orderDetailResponse.json();
    
  // Ищем managed item чтобы проверить текущее состояние
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
  
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
  let NEW_BANDWIDTH = availableBandwidths[Math.floor(Math.random() * availableBandwidths.length)];
  
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
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/change_bandwidth_managed`,
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
      `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что ширина канала изменилась в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
    
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы проверить текущее состояние Public IP
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
  
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
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/disable_fip_managed_redis`,
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
      `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что Public IP пропал из конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
    
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

export async function createUser(orderId: string, itemId: string, clusterName: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  // Генерируем случайные данные пользователя
  const username = generateRandomUsername();
  const password = generateRandomPassword();
  
  console.log('Создаем пользователя с именем:', username);
  console.log('Длина пароля:', password.length, 'символов');

  // Создаем юзера
  const createUserPayload = {
    name: username,
    password: password,
    rules: "~* +@all",
    should_be_admin: false
  };

  const createUserResponse = await api.post(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/services/${clusterName}/users`,
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

  console.log(`// ID команды из URL ${commandId}`)

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
        `/redis-manager/api/v1/projects/${PROJECT_ID}/commands/${commandId}`
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

export async function createBackup(orderId: string, itemId: string, clusterName: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед созданием бэкапа...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  console.log(`Начинаем создание резервной копии для Redis кластера: ${clusterName}`);

  // Создаем резервную копию
  const createBackupResponse = await api.post(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/services/${clusterName}/backups`
  );

  console.log('Статус ответа на создание резервной копии:', createBackupResponse.status());

  if (createBackupResponse.status() !== 202) {
    const errorBody = await createBackupResponse.text();
    throw new Error(`Ожидался статус 202, но получен ${createBackupResponse.status()}: ${errorBody}`);
  }

  const createBackupData = await createBackupResponse.json();
  console.log('Команда создания резервной копии отправлена, URL:', createBackupData.url);

  // Извлекаем ID команды из URL
  const commandId = createBackupData.url.split('/').pop();
  console.log('Command ID для проверки статуса:', commandId);

  // Ждем завершения операции создания резервной копии
  console.log('Ждем завершения операции создания резервной копии...');

  const startTime = Date.now();
  const maxWaitTime = 10 * 60 * 1000; 
  let isCompleted = false;
  let retryCount = 0;
  const maxRetries = 3;
  let backupName = '';

  while (!isCompleted && Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 30000));

    if (shouldRefreshToken()) {
      console.log('Обновляем токен...');
      await refreshAPIContext();
      api = getAPIContext();
    }

    try {
      const commandResponse = await api.get(
        `/redis-manager/api/v1/projects/${PROJECT_ID}/commands/${commandId}`
      );

      if (commandResponse.status() !== 200) {
        const errorBody = await commandResponse.text();
        
        if (commandResponse.status() >= 500 && retryCount < maxRetries) {
          retryCount++;
          console.log(`Ошибка сервера, повторная попытка ${retryCount}/${maxRetries}: ${errorBody}`);
          await new Promise((resolve) => setTimeout(resolve, 10000));
          continue;
        }
        
        throw new Error(`Ошибка при проверке статуса команды: ${commandResponse.status()} - ${errorBody}`);
      }

      const commandData = await commandResponse.json();
      
      const secondsPassed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[${secondsPassed} сек] Статус команды: ${commandData.status}`);

      if (commandData.status === 'success') {
        isCompleted = true;
        console.log('Резервная копия успешно создана');
        
        // Получаем информацию о созданном бэкапе сразу после успеха
        console.log('Получаем информацию о созданной резервной копии...');
        const listBackupsResponse = await api.get(
          `/redis-manager/api/v1/projects/${PROJECT_ID}/services/${clusterName}/backups`
        );

        if (listBackupsResponse.status() === 200) {
          const backupsData = await listBackupsResponse.json();
          if (backupsData.backups && backupsData.backups.length > 0) {
            backupName = backupsData.backups[0].backup_name;
            console.log(`Создана резервная копия: ${backupName}`);
            console.log(`Статус бэкапа: ${backupsData.backups[0].status}`);
            console.log(`Размер: ${backupsData.backups[0].size} байт`);
          } else {
            console.log('Внимание: резервные копии не найдены после успешного создания');
          }
        } else {
          console.log('Не удалось получить список бэкапов, но создание завершено успешно');
        }
        
        break;
      } else if (commandData.status === 'failed') {
        throw new Error(`Создание резервной копии завершилось ошибкой: ${commandData.error || 'Неизвестная ошибка'}`);
      }

      retryCount = 0;

    } catch (error) {
      retryCount++;
      console.log(`Сетевая ошибка (попытка ${retryCount}/${maxRetries}):`, String(error));
      
      if (retryCount >= maxRetries) {
        throw new Error('Превышено количество попыток из-за сетевых ошибок');
      }
      
      console.log('Повторная попытка через 10 секунд...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      await refreshAPIContext();
      api = getAPIContext();
    }
  }

  if (!isCompleted) {
    throw new Error('Создание резервной копии не завершилось за отведенное время');
  }

  console.log('Операция создания резервной копии завершена успешно!');
  return backupName || 'unknown_backup';
}

export async function editSettings(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы получить текущие настройки
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item в заказе');
  }

  // Извлекаем текущие значения из конфигурации кластера
  const currentClusterDescription = managedItem.data.config.service?.description;
  const currentRedisVersion = managedItem.data.config.redis_version;
  const currentSettings = managedItem.data.config.service?.settings || {};
  const currentTimeout = currentSettings.timeout;
  const currentAof = managedItem.data.config.service?.aof || {};
  const currentRdb = managedItem.data.config.service?.rdb || {};
  const currentAutoBackup = managedItem.data.config.service?.backup || {};

  console.log('Текущее значение timeout:', currentTimeout);
  console.log('Текущие настройки AOF:', currentAof);
  console.log('Текущие настройки RDB:', currentRdb);
  console.log('Текущие настройки авто-бэкапа:', currentAutoBackup);

  // Генерируем новые настройки
  let newTimeout = Math.floor(Math.random() * 200) + 300; // от 300 до 500

  // Проверяем что новое значение отличается от текущего
  if (currentTimeout === newTimeout) {
    console.log(`Текущее значение ${currentTimeout} совпадает с новым, выбираем другое значение`);
    const alternativeTimeouts = [350, 400, 450, 500];
    const availableOptions = alternativeTimeouts.filter(val => val !== currentTimeout);
    if (availableOptions.length === 0) {
      throw new Error('Нет доступных значений для изменения timeout');
    }
    newTimeout = availableOptions[Math.floor(Math.random() * availableOptions.length)];
  }

  // Меняем настройки авто-бэкапа
  const newBackupSchedule = currentAutoBackup.schedule_time === '00:00:00' ? '00:30:00' : '00:00:00';
  const newBackupRetention = currentAutoBackup.retention_number === 7 ? 5 : 7;

  // Меняем настройки RDB (включаем/выключаем)
  const newRdbEnabled = !currentRdb.enabled;

  console.log(`Устанавливаем timeout: ${newTimeout}`);
  console.log(`Устанавливаем schedule_time: ${newBackupSchedule}`);
  console.log(`Устанавливаем retention_number: ${newBackupRetention}`);
  console.log(`Устанавливаем RDB enabled: ${newRdbEnabled}`);

  // Изменяем настройки кластера
  const changeSettingsPayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
    order: {
      attrs: {
        aof: {
          fsync: currentAof.fsync || 'everysec',
          enabled: currentAof.enabled !== undefined ? currentAof.enabled : true
        },
        rdb: {
          save: currentRdb.save || '300 10',
          enabled: newRdbEnabled,
          compression: currentRdb.compression !== undefined ? currentRdb.compression : true
        },
        parameters: {
          timeout: newTimeout,
          "tcp-backlog": currentSettings["tcp-backlog"] || 511,
          "tcp-keepalive": currentSettings["tcp-keepalive"] || 300,
          "maxmemory-policy": currentSettings["maxmemory-policy"] || 'noeviction'
        },
        auto_backup: {
          enabled: currentAutoBackup.enabled !== undefined ? currentAutoBackup.enabled : true,
          schedule_time: newBackupSchedule,
          retention_number: newBackupRetention
        },
        redis_version: currentRedisVersion,
        maintance_window: managedItem.data.config.maintance_window || {
          day: 0,
          time_range: "00:00 - 01:00"
        }
      }
    }
  };

  const changeSettingsResponse = await api.patch(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/edit_redis_vm_settings`,
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
        `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что настройки изменились в конфигурации
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
      
      if (currentManagedItem) {
        const updatedSettings = currentManagedItem.data.config.service?.settings || {};
        const updatedTimeout = updatedSettings.timeout;
        const updatedRdb = currentManagedItem.data.config.service?.rdb || {};
        const updatedAutoBackup = currentManagedItem.data.config.service?.backup || {};
        
        if (updatedTimeout === newTimeout && 
            updatedRdb.enabled === newRdbEnabled &&
            updatedAutoBackup.schedule_time === newBackupSchedule &&
            updatedAutoBackup.retention_number === newBackupRetention) {
          
          isCompleted = true;
          console.log('Настройки успешно изменены');
          
          // Финальная проверка
          console.log('Финальное значение timeout:', updatedTimeout);
          console.log('Финальное значение RDB enabled:', updatedRdb.enabled);
          console.log('Финальное значение schedule_time:', updatedAutoBackup.schedule_time);
          console.log('Финальное значение retention_number:', updatedAutoBackup.retention_number);
          
          if (updatedTimeout !== newTimeout) {
            throw new Error(`Ожидалось значение timeout ${newTimeout}, но получено ${updatedTimeout}`);
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  return {
    timeout: newTimeout,
    rdbEnabled: newRdbEnabled,
    backupSchedule: newBackupSchedule,
    backupRetention: newBackupRetention
  };
}

export async function disableAutoBackup(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы получить текущие настройки
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item в заказе');
  }

  // Извлекаем текущие значения из конфигурации кластера
  const currentRedisVersion = managedItem.data.config.redis_version;
  const currentSettings = managedItem.data.config.service?.settings || {};
  const currentAof = managedItem.data.config.service?.aof || {};
  const currentRdb = managedItem.data.config.service?.rdb || {};
  const currentAutoBackup = managedItem.data.config.service?.backup || {};

  console.log('Текущие настройки авто-бэкапа:', currentAutoBackup);

  // Проверяем текущее состояние авто-бэкапа
  if (currentAutoBackup.enabled === false) {
    console.log('Автоматическое резервное копирование уже отключено');
    return { backupEnabled: false };
  }

  console.log('Отключаем автоматическое резервное копирование...');

  // Отключаем автоматическое резервное копирование
  const disableBackupPayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
  
    order: {
      attrs: {
        aof: {
          fsync: currentAof.fsync || 'everysec',
          enabled: currentAof.enabled !== undefined ? currentAof.enabled : true
        },
        rdb: {
          save: currentRdb.save || '300 10',
          enabled: currentRdb.enabled !== undefined ? currentRdb.enabled : true,
          compression: currentRdb.compression !== undefined ? currentRdb.compression : true
        },
        parameters: {
          timeout: currentSettings.timeout || 300,
          "tcp-backlog": currentSettings["tcp-backlog"] || 511,
          "tcp-keepalive": currentSettings["tcp-keepalive"] || 300,
          "maxmemory-policy": currentSettings["maxmemory-policy"] || 'noeviction'
        },
        auto_backup: {
          enabled: false, // Отключаем авто-бэкап
          schedule_time: currentAutoBackup.schedule_time || '00:00:00',
          retention_number: currentAutoBackup.retention_number || 7
        },
        redis_version: currentRedisVersion,
        maintance_window: managedItem.data.config.maintance_window || {
          day: 0,
          time_range: "00:00 - 01:00"
        }
      }
    }
  };

  const disableBackupResponse = await api.patch(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/edit_redis_vm_settings`,
    { data: disableBackupPayload }
  );

  console.log('Статус ответа на отключение авто-бэкапа:', disableBackupResponse.status());

  if (disableBackupResponse.status() !== 200) {
    const errorBody = await disableBackupResponse.text();
    throw new Error(`Ожидался статус 200, но получен ${disableBackupResponse.status()}: ${errorBody}`);
  }

  console.log('Запрос на отключение авто-бэкапа отправлен успешно');

  // Ждем завершения операции
  console.log('Ждем завершения операции отключения авто-бэкапа...');

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
        `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что авто-бэкап отключен в конфигурации
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
      
      if (currentManagedItem) {
        const updatedAutoBackup = currentManagedItem.data.config.service?.backup || {};
        
        if (updatedAutoBackup.enabled === false) {
          isCompleted = true;
          console.log('Автоматическое резервное копирование успешно отключено');
          
          // Финальная проверка
          console.log('Финальное значение backup enabled:', updatedAutoBackup.enabled);
          
          if (updatedAutoBackup.enabled !== false) {
            throw new Error('Авто-бэкап не был отключен');
          }
          
          break;
        }
      }

      if (statusData.status === 'error') {
        throw new Error('Операция отключения авто-бэкапа завершилась ошибкой');
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
    throw new Error('Отключение авто-бэкапа не завершилось за отведенное время');
  }

  console.log('Операция отключения авто-бэкапа завершена успешно!');

  // Финальная проверка статуса кластера после изменения настроек
  console.log('Проверяем статус кластера после отключения авто-бэкапа...');
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  return { backupEnabled: false };
}

export async function addRedisNode(
  orderId: string, 
  itemId: string, 
  nodesToAdd: number = 2 // по умолчанию оставляем 2 для сентинела, для кластера укажем 4
) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  // Получаем текущую конфигурацию чтобы узнать количество нод
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item для Redis
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item для Redis в заказе');
  }

  const currentNodes = managedItem.data.config.number_of_vms;
  const serviceType = managedItem.data.config.service?.service_type || managedItem.data.config.service_type;
  
  console.log(`Текущее количество нод: ${currentNodes}`);
  console.log(`Тип сервиса: ${serviceType}`);

  const addNodePayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
    order: {
      attrs: {
        quantity: nodesToAdd  
      }
    }
  };

  const addNodeResponse = await api.patch(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/add_vm_to_redis`, 
    { data: addNodePayload }
  );

  console.log('Статус ответа на добавление ноды:', addNodeResponse.status());

  if (addNodeResponse.status() !== 200) {
    const errorBody = await addNodeResponse.text();
    throw new Error(`Ожидался статус 200, но получен ${addNodeResponse.status()}: ${errorBody}`);
  }

  const responseData = await addNodeResponse.json();
  console.log('Запрос на добавление ноды отправлен успешно');
  console.log('ID заказа после добавления ноды:', responseData.id);

  // Ждем завершения операции
  console.log(`Ждем завершения операции добавления ${nodesToAdd} нод...`);

  const startTime = Date.now();
  const maxWaitTime = 20 * 60 * 1000;
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
        `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что количество нод увеличилось
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
      
      if (currentManagedItem) {
        const updatedNodes = currentManagedItem.data.config.number_of_vms;
        const expectedNodes = currentNodes + nodesToAdd;
        
        console.log(`Текущее количество нод: ${updatedNodes}, ожидаемое: ${expectedNodes}`);
        
        if (updatedNodes === expectedNodes) {
          isCompleted = true;
          console.log(`Количество нод увеличено с ${currentNodes} до ${updatedNodes}`);
          
          // Дополнительная проверка - убеждаемся что заказ завершился успешно
          if (statusData.status === 'success') {
            console.log('Заказ завершен успешно');
            break;
          }
        } else if (updatedNodes > currentNodes) {
          console.log(`Количество нод изменилось с ${currentNodes} до ${updatedNodes}, но не соответствует ожидаемому ${expectedNodes}`);
        }
      }

      // Проверяем статус заказа
      if (statusData.status === 'success' && isCompleted) {
        console.log('Заказ завершен успешно');
        break;
      } else if (statusData.status === 'error') {
        throw new Error('Операция добавления ноды завершилась ошибкой');
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
    throw new Error(`Добавление ${nodesToAdd} нод не завершилось за отведенное время`);
  }

  console.log(`Операция добавления ${nodesToAdd} нод завершена успешно!`);
  return nodesToAdd; // Возвращаем количество добавленных нод
}

// !! Актуально только для редис кластеров
export async function removeRedisNodes(
  orderId: string, 
  itemId: string, 
  nodesToRemove: number = 2
) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  // Получаем текущую конфигурацию чтобы узнать количество нод и список серверов
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item для Redis
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item для Redis в заказе');
  }

  const currentNodes = managedItem.data.config.number_of_vms;
  const serviceType = managedItem.data.config.service?.service_type || managedItem.data.config.service_type;
  
  console.log(`Текущее количество нод: ${currentNodes}`);
  console.log(`Тип сервиса: ${serviceType}`);

  // Проверяем что после удаления останется достаточно нод
  const minNodesRequired = 3;
  const expectedNodesAfterRemoval = currentNodes - nodesToRemove;
  
  if (expectedNodesAfterRemoval < minNodesRequired) {
    throw new Error(`Нельзя удалить ${nodesToRemove} нод. После удаления останется ${expectedNodesAfterRemoval} нод, минимально требуется ${minNodesRequired}`);
  }

  // Получаем список серверов для удаления (берем последние добавленные ноды)
  const servers = managedItem.data.config.service?.servers || [];
  console.log(`Всего серверов в конфигурации: ${servers.length}`);
  
  // Берем последние nodesToRemove серверов для удаления
  const serversToRemove = servers.slice(-nodesToRemove);
  const serverIdsToRemove = serversToRemove.map((server: any) => server.name);
  
  console.log(`Серверы для удаления: ${serverIdsToRemove.join(', ')}`);

  const removeNodesPayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
    order: {
      attrs: {
        item_id: serverIdsToRemove
      }
    }
  };

  console.log('Отправляем запрос на удаление нод:', JSON.stringify(removeNodesPayload, null, 2));

  const removeNodesResponse = await api.patch(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/delete_several_vms_mongo`, 
    { data: removeNodesPayload }
  );

  console.log('Статус ответа на удаление нод:', removeNodesResponse.status());

  if (removeNodesResponse.status() !== 200) {
    const errorBody = await removeNodesResponse.text();
    throw new Error(`Ожидался статус 200, но получен ${removeNodesResponse.status()}: ${errorBody}`);
  }

  const responseData = await removeNodesResponse.json();
  console.log('Запрос на удаление нод отправлен успешно');
  console.log('ID заказа после удаления нод:', responseData.id);

  // Ждем завершения операции
  console.log(`Ждем завершения операции удаления ${nodesToRemove} нод...`);

  const startTime = Date.now();
  const maxWaitTime = 20 * 60 * 1000;
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
        `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что количество нод уменьшилось
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
      
      if (currentManagedItem) {
        const updatedNodes = currentManagedItem.data.config.number_of_vms;
        const expectedNodes = currentNodes - nodesToRemove;
        
        console.log(`Текущее количество нод: ${updatedNodes}, ожидаемое: ${expectedNodes}`);
        
        if (updatedNodes === expectedNodes) {
          isCompleted = true;
          console.log(`Количество нод уменьшено с ${currentNodes} до ${updatedNodes}`);
          
          // Дополнительная проверка - убеждаемся что заказ завершился успешно
          if (statusData.status === 'success') {
            console.log('Заказ завершен успешно');
            break;
          }
        } else if (updatedNodes < currentNodes) {
          console.log(`Количество нод изменилось с ${currentNodes} до ${updatedNodes}, но не соответствует ожидаемому ${expectedNodes}`);
        }
      }

      // Проверяем статус заказа
      if (statusData.status === 'success' && isCompleted) {
        console.log('Заказ завершен успешно');
        break;
      } else if (statusData.status === 'error') {
        throw new Error('Операция удаления нод завершилась ошибкой');
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
    throw new Error(`Удаление ${nodesToRemove} нод не завершилось за отведенное время`);
  }

  console.log(`Операция удаления ${nodesToRemove} нод завершена успешно!`);
  return nodesToRemove; // Возвращаем количество удаленных нод
}

export async function resizeFlavor(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item для Redis
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item для Redis в заказе');
  }

  // Получаем текущий flavor
  const currentFlavor = managedItem.data.config.flavor;
  console.log('Текущий flavor:', currentFlavor.name);
  console.log('Текущие параметры:', `${currentFlavor.ram}MB RAM, ${currentFlavor.vcpus} vCPUs`);

  // Проверяем, не совпадают ли уже целевые параметры
  if (currentFlavor.ram === 8192 && currentFlavor.vcpus === 4) {
    console.log('Кластер уже имеет целевые параметры (8192MB RAM, 4 vCPUs)');
    return { ram: 8192, vcpus: 4 };
  }

  // Создаем новый flavor с обновленными параметрами
  const newFlavor = {
    ...currentFlavor,           // Копируем ВСЕ поля из currentFlavor
    ram: 8192,                  // Перезаписываем только RAM
    vcpus: 4,                   // Перезаписываем только vCPUs
    // name НЕ перезаписываем - оставляем оригинальное имя
    extra_specs: {
      ...currentFlavor.extra_specs,  // Копируем ВСЕ extra_specs
      // Дополнительные спецификации остаются прежними
    }
  };

  console.log('Новый flavor:', newFlavor.name);
  console.log('Новые параметры:', `${newFlavor.ram}MB RAM, ${newFlavor.vcpus} vCPUs`);

  const resizePayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
    order: {
      attrs: {
        flavor: newFlavor
      }
    }
  };

  console.log('Отправляем запрос на изменение CPU/RAM...');

  const resizeResponse = await api.patch(
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/resize_flavor`,
    { data: resizePayload }
  );

  console.log('Статус ответа на изменение CPU/RAM:', resizeResponse.status());

  if (resizeResponse.status() !== 200) {
    const errorBody = await resizeResponse.text();
    throw new Error(`Ожидался статус 200, но получен ${resizeResponse.status()}: ${errorBody}`);
  }

  const responseData = await resizeResponse.json();
  console.log('Запрос на изменение CPU/RAM отправлен успешно');

  // Ждем завершения операции
  console.log('Ждем завершения операции изменения CPU/RAM...');

  const startTime = Date.now();
  const maxWaitTime = 20 * 60 * 1000;
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
        `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что flavor изменился в конфигурации
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'redis_vm');
      
      if (currentManagedItem) {
        const updatedFlavor = currentManagedItem.data.config.flavor;
        console.log(`Текущие параметры: ${updatedFlavor.ram}MB RAM, ${updatedFlavor.vcpus} vCPUs`);
        
        if (updatedFlavor.ram === 8192 && updatedFlavor.vcpus === 4) {
          isCompleted = true;
          console.log('Параметры CPU/RAM успешно изменены');
          
          // Дополнительная проверка - убеждаемся что заказ завершился успешно
          if (statusData.status === 'success') {
            console.log('Заказ завершен успешно');
            break;
          }
        }
      }

      // Проверяем статус заказа
      if (statusData.status === 'success' && isCompleted) {
        console.log('Заказ завершен успешно');
        break;
      } else if (statusData.status === 'error') {
        throw new Error('Операция изменения CPU/RAM завершилась ошибкой');
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
    throw new Error('Изменение CPU/RAM не завершилось за отведенное время');
  }

  console.log('Операция изменения CPU/RAM завершена успешно!');

  // Финальная проверка статуса кластера после изменения
  console.log('Проверяем статус кластера после изменения CPU/RAM...');
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'redis');

  return { ram: 8192, vcpus: 4 };
}

export async function deleteCluster(orderId: string, itemId: string, clusterName: string) {
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
    `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/delete_cluster_for_redis`,
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
        `/redis-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
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
