import { OrderDataFactory } from '../data/OrderDataFactory';
import { getAPIContext, refreshAPIContext, shouldRefreshToken } from './api-context';
import { checkClusterStatus } from './cluster-status';
import { generateRandomUsername, generateRandomPassword } from '../common/test-data-generators';
import {ProductType} from '../data/OrderDataFactory'

const PROJECT_ID = process.env.PROJECT_ID!;

export async function createCluster(productType: string = 'opensearch-single') {
  const orderData = OrderDataFactory.createOrderData(productType as ProductType);
  const body = orderData.buildOrderBody();
  const clusterName = body.order.attrs.cluster_name;

  console.log('Создаем заказ:', clusterName);
  console.log('Тип кластера:', productType);

  let api = getAPIContext();
  
  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  const createResponse = await api.post(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders`,
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
        `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders?page=1&per_page=5`
      );

      if (listResponse.status() === 200) {
        const listResult = await listResponse.json();
        const ourOrder = listResult.list.find((order: any) => order.id === orderId);

        if (ourOrder && ourOrder.status === 'success') {
          isDeployed = true;
          console.log('Кластер развернут!');

          const detailResponse = await api.get(
            `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
          );
          const detailData = await detailResponse.json();
          
          const managedItem = detailData.data.find((item: any) => item.type === 'managed');
          const itemId = managedItem.item_id;
          
          console.log('Кластер создан:', { orderId, itemId, productType });
          
          // ВОЗВРАЩАЕМ productType ДЛЯ ЦЕПОЧКИ
          return { 
            orderId, 
            itemId, 
            clusterName,
            clusterType: productType // ДОБАВЛЯЕМ ТИП КЛАСТЕРА
          };
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
// opensearch-operations.ts
export async function extendDisk(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }
  
  // Получаем информацию о заказе
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item для opensearch
  const managedItem = orderDetail.data.find((item: any) => 
    item.type === 'managed' && item.provider === 'opensearch_vm'
  );
  
  if (!managedItem) {
    throw new Error('Не найден managed item для opensearch в заказе');
  }
  
  const CURRENT_SIZE = managedItem.data.config.boot_volume.size;
  
  console.log('Актуальный размер диска:', CURRENT_SIZE, 'GB');
  
  const NEW_DISK_SIZE = CURRENT_SIZE + 1;
  
  console.log(`Увеличиваем диск с ${CURRENT_SIZE}GB до ${NEW_DISK_SIZE}GB`);

  // Используем универсальную проверку статуса с указанием типа продукта
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  const response = await api.patch(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/extend_disk_size`,
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
      `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    if (statusData.status === 'success') {
      isCompleted = true;
      
      // Ищем обновленный managed item для opensearch
      const updatedManagedItem = statusData.data.find((item: any) => 
        item.type === 'managed' && item.provider === 'opensearch_vm'
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');
  
  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы проверить текущее состояние Public IP
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
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
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/add_fip_managed_opensearch`,
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
      `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что Public IP появился в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
    
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');
  
  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );

  const orderDetail = await orderDetailResponse.json();
    
  // Ищем managed item чтобы проверить текущее состояние
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
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
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/change_bandwidth_managed`,
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
      `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что ширина канала изменилась в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
    
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы проверить текущее состояние Public IP
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
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
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/disable_fip_managed_opensearch`,
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
      `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что Public IP пропал из конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
    
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  // Генерируем случайные данные пользователя
  const username = generateRandomUsername();
  const password = generateRandomPassword();
  
  console.log('Создаем пользователя OpenSearch с именем:', username);
  console.log('Длина пароля:', password.length, 'символов');

  // Создаем юзера - OpenSearch использует другую структуру payload
  const createUserPayload = {
    username: username,
    password: password
  };

  const createUserResponse = await api.post(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/services/${clusterName}/users`,
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
  console.log('Ждем завершения операции создания пользователя OpenSearch...');

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
        `/opensearch-manager/api/v1/projects/${PROJECT_ID}/commands/${commandId}`
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
        console.log('Пользователь OpenSearch успешно создан');
        break;
      } else if (commandData.status === 'failed') {
        throw new Error(`Создание пользователя OpenSearch завершилось ошибкой: ${commandData.error || 'Неизвестная ошибка'}`);
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
    throw new Error('Создание пользователя OpenSearch не завершилось за отведенное время');
  }

  console.log('Операция создания пользователя OpenSearch завершена успешно!');
  return username; // Возвращаем имя созданного пользователя
}

export async function resizeFlavor(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item для OpenSearch
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item для OpenSearch в заказе');
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
    ...currentFlavor,           
    ram: 8192,                  // Перезаписываем только RAM
    vcpus: 4,                   // Перезаписываем только vCPUs
   
    extra_specs: {
      ...currentFlavor.extra_specs,  
      
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
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/resize_flavor`,
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
        `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что flavor изменился в конфигурации
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
      
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
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  return { ram: 8192, vcpus: 4 };
}

export async function deleteCluster(orderId: string, itemId: string, clusterName: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  console.log('Начинаем удаление OpenSearch кластера:', clusterName);

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
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/delete_cluster_for_opensearch`,
    { data: deleteClusterPayload }
  );

  console.log('Статус ответа на удаление кластера:', deleteResponse.status());

  if (deleteResponse.status() !== 200) {
    const errorBody = await deleteResponse.text();
    throw new Error(`Ожидался статус 200, но получен ${deleteResponse.status()}: ${errorBody}`);
  }

  console.log('Запрос на удаление OpenSearch кластера отправлен успешно');

  // Ждем завершения операции удаления
  console.log('Ждем завершения операции удаления OpenSearch кластера...');

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
        `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Ищем managed item и проверяем его состояние
      const managedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
      
      if (managedItem) {
        const itemState = managedItem.data.state;
        console.log(`Состояние managed item: ${itemState}`);
        
        // Если managed item в состоянии 'deleted' - кластер удален
        if (itemState === 'deleted') {
          isDeleted = true;
          console.log('Managed item удален - OpenSearch кластер удален');
          break;
        }
      } else {
        // Если managed item не найден - он уже удален
        console.log('Managed item не найден в ответе - OpenSearch кластер удален');
        isDeleted = true;
        break;
      }

      // Дополнительная проверка - если все items в состоянии 'deleted'
      const allItemsDeleted = statusData.data.every((item: any) => item.data?.state === 'deleted');
      if (allItemsDeleted) {
        isDeleted = true;
        console.log('Все items удалены - OpenSearch кластер полностью удален');
        break;
      }

      if (statusData.status === 'error') {
        throw new Error('Операция удаления OpenSearch кластера завершилась ошибкой');
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
    throw new Error('Удаление OpenSearch кластера не завершилось за отведенное время');
  }

  console.log('Операция удаления OpenSearch кластера завершена успешно!');
  return true; // Возвращаем true для подтверждения удаления
}

/**
 *  Действия для опенсерч кластера и опенсерча дашборд-кластера
 */

//  Для кластера 1-1-0
export async function extendOpenSearchClusterDisk(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }
  
  // Получаем информацию о заказе
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item для opensearch
  const managedItem = orderDetail.data.find((item: any) => 
    item.type === 'managed' && item.provider === 'opensearch_vm'
  );
  
  if (!managedItem) {
    throw new Error('Не найден managed item для opensearch в заказе');
  }
  
  // Для кластера получаем размеры дисков из flavor_cluster
  const dataGroupSize = managedItem.data.config.flavor_cluster.data_group.boot_volume.size;
  const managerGroupSize = managedItem.data.config.flavor_cluster.manager_group.boot_volume.size;
  
  console.log('Актуальные размеры дисков:');
  console.log('- Data Group:', dataGroupSize, 'GB');
  console.log('- Manager Group:', managerGroupSize, 'GB');
  
  const NEW_DISK_SIZE = dataGroupSize + 1;
  
  console.log(`Увеличиваем диски с ${dataGroupSize}GB до ${NEW_DISK_SIZE}GB`);

  // Используем универсальную проверку статуса с указанием типа продукта
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  const response = await api.patch(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/extend_disk_size_opensearch_cluster`,
    {
      data: {
        project_name: PROJECT_ID,
        id: orderId,
        item_id: itemId,
        order: {
          attrs: {
            data_group: {
              new_size: NEW_DISK_SIZE
            },
            manager_group: {
              new_size: NEW_DISK_SIZE
            },
            dashboard_group: {
              new_size: 0  // Dashboard отключен, размер 0
            }
          },
        },
      },
    },
  );

  console.log('Статус ответа:', response.status());
  
  if (response.status() !== 200) {
    const errorBody = await response.text();
    throw new Error(`Действие на увеличения диска кластера упало: ${errorBody}`);
  }

  console.log('Запрос отправлен успешно');

  console.log('Ждем завершения операции...');

  const startTime = Date.now();
  const maxWaitTime = 15 * 60 * 1000;
  let isCompleted = false;

  while (!isCompleted && Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 60000));

    const statusResponse = await api.get(
      `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    if (statusData.status === 'success') {
      isCompleted = true;
      
      // Ищем обновленный managed item для opensearch
      const updatedManagedItem = statusData.data.find((item: any) => 
        item.type === 'managed' && item.provider === 'opensearch_vm'
      );
      
      const finalDataSize = updatedManagedItem.data.config.flavor_cluster.data_group.boot_volume.size;
      const finalManagerSize = updatedManagedItem.data.config.flavor_cluster.manager_group.boot_volume.size;
      
      console.log('Финальные размеры дисков:');
      console.log('- Data Group:', finalDataSize, 'GB');
      console.log('- Manager Group:', finalManagerSize, 'GB');
      
      if (finalDataSize !== NEW_DISK_SIZE || finalManagerSize !== NEW_DISK_SIZE) {
        throw new Error(`Ожидаемый размер дисков ${NEW_DISK_SIZE}GB, но фактически Data: ${finalDataSize}GB, Manager: ${finalManagerSize}GB`);
      }
      
      break;
    } else if (statusData.status === 'error') {
      throw new Error('Увеличение размера диска кластера упало');
    }
  }

  if (!isCompleted) {
    throw new Error('Увеличение размера диска кластера упало по таймауту');
  }

  console.log('Операция увеличения диска кластера завершена успешно!');
}

export async function addPublicIpCluster(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');
  
  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы проверить текущее состояние Public IP
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
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
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/add_fip_managed_opensearch_cluster`,
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
      `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что Public IP появился в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
    
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

export async function changeBandwidthCluster(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');
  
  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );

  const orderDetail = await orderDetailResponse.json();
    
  // Ищем managed item чтобы проверить текущее состояние
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
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
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/change_bandwidth_managed_opensearch_cluster`,
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
      `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что ширина канала изменилась в конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
    
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

export async function disablePublicIpCluster(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item чтобы проверить текущее состояние Public IP
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
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
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/disable_fip_managed_opensearch_cluster`,
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
      `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
    );

    const statusData = await statusResponse.json();
    
    const minutesPassed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

    // Проверяем что Public IP пропал из конфигурации
    const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
    
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

export async function addOpenSearchNode(
  orderId: string, 
  itemId: string,
  dataGroupQuantity: number = 1,
  managerGroupQuantity: number = 2, 
  dashboardGroupQuantity: number = 0
) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  console.log('Добавляем новые ноды в OpenSearch кластер');

  // Получаем текущую конфигурацию чтобы узнать количество нод в группах
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item в заказе');
  }

  // Получаем текущие количества нод в группах
  const currentDataNodes = managedItem.data.config.flavor_cluster.data_group.number_of_vms;
  const currentManagerNodes = managedItem.data.config.flavor_cluster.manager_group.number_of_vms;
  const currentDashboardNodes = managedItem.data.config.flavor_cluster.dashboard_group.number_of_vms;

  console.log('Текущее количество нод:');
  console.log(`- Data Group: ${currentDataNodes}`);
  console.log(`- Manager Group: ${currentManagerNodes}`);
  console.log(`- Dashboard Group: ${currentDashboardNodes}`);

  // Вычисляем ожидаемые количества после добавления
  const expectedDataNodes = currentDataNodes + dataGroupQuantity;
  const expectedManagerNodes = currentManagerNodes + managerGroupQuantity;
  const expectedDashboardNodes = currentDashboardNodes + dashboardGroupQuantity;

  console.log('Добавляем ноды:');
  console.log(`- Data Group: +${dataGroupQuantity} (будет ${expectedDataNodes})`);
  console.log(`- Manager Group: +${managerGroupQuantity} (будет ${expectedManagerNodes})`);
  console.log(`- Dashboard Group: +${dashboardGroupQuantity} (будет ${expectedDashboardNodes})`);

  const addNodePayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
    order: {
      attrs: {
        data_group: {
          quantity: dataGroupQuantity
        },
        manager_group: {
          quantity: managerGroupQuantity
        },
        dashboard_group: {
          quantity: dashboardGroupQuantity
        }
      }
    }
  };

  const addNodeResponse = await api.patch(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/add_vm_to_opensearch_cluster`, 
    { data: addNodePayload }
  );

  console.log('Статус ответа на добавление нод:', addNodeResponse.status());

  if (addNodeResponse.status() !== 200) {
    const errorBody = await addNodeResponse.text();
    throw new Error(`Ожидался статус 200, но получен ${addNodeResponse.status()}: ${errorBody}`);
  }

  const responseData = await addNodeResponse.json();
  console.log('Запрос на добавление нод отправлен успешно');
  console.log('ID заказа после добавления нод:', responseData.id);

  // Ждем завершения операции
  console.log('Ждем завершения операции добавления нод...');

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
        `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что количество нод увеличилось во всех группах
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
      
      if (currentManagedItem) {
        const updatedDataNodes = currentManagedItem.data.config.flavor_cluster.data_group.number_of_vms;
        const updatedManagerNodes = currentManagedItem.data.config.flavor_cluster.manager_group.number_of_vms;
        const updatedDashboardNodes = currentManagedItem.data.config.flavor_cluster.dashboard_group.number_of_vms;
        
        console.log('Текущее количество нод:');
        console.log(`- Data Group: ${updatedDataNodes}, ожидаемое: ${expectedDataNodes}`);
        console.log(`- Manager Group: ${updatedManagerNodes}, ожидаемое: ${expectedManagerNodes}`);
        console.log(`- Dashboard Group: ${updatedDashboardNodes}, ожидаемое: ${expectedDashboardNodes}`);
        
        if (updatedDataNodes === expectedDataNodes && 
            updatedManagerNodes === expectedManagerNodes && 
            updatedDashboardNodes === expectedDashboardNodes) {
          isCompleted = true;
          console.log('Количество нод успешно увеличено во всех группах');
          break;
        }
      }

      // Проверяем статус заказа
      if (statusData.status === 'success' && isCompleted) {
        console.log('Заказ завершен успешно');
        break;
      } else if (statusData.status === 'error') {
        throw new Error('Операция добавления нод завершилась ошибкой');
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
    throw new Error('Добавление нод не завершилось за отведенное время');
  }

  console.log('Операция добавления нод завершена успешно!');
  
  return {
    dataGroupAdded: dataGroupQuantity,
    managerGroupAdded: managerGroupQuantity,
    dashboardGroupAdded: dashboardGroupQuantity,
    totalAdded: dataGroupQuantity + managerGroupQuantity + dashboardGroupQuantity
  };
}

export async function resizeOpenSearchClusterFlavor(orderId: string, itemId: string) {
  let api = getAPIContext();

  if (shouldRefreshToken()) {
    console.log('Обновляем токен перед запросом...');
    await refreshAPIContext();
    api = getAPIContext();
  }

  // Проверяем статус кластера перед выполнением операции
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  // Получаем текущую конфигурацию кластера
  const orderDetailResponse = await api.get(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderDetail = await orderDetailResponse.json();
  
  // Ищем managed item для OpenSearch
  const managedItem = orderDetail.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
  
  if (!managedItem) {
    throw new Error('Не найден managed item для OpenSearch в заказе');
  }

  // Получаем текущие flavor из всех групп
  const currentDataFlavor = managedItem.data.config.flavor_cluster.data_group.flavor;
  const currentManagerFlavor = managedItem.data.config.flavor_cluster.manager_group.flavor;
  
  console.log('Текущие параметры:');
  console.log(`- Data Group: ${currentDataFlavor.ram}MB RAM, ${currentDataFlavor.vcpus} vCPUs`);
  console.log(`- Manager Group: ${currentManagerFlavor.ram}MB RAM, ${currentManagerFlavor.vcpus} vCPUs`);

  // Проверяем, не совпадают ли уже целевые параметры
  const isAlreadyResized = currentDataFlavor.ram === 8192 && currentDataFlavor.vcpus === 4 &&
                          currentManagerFlavor.ram === 8192 && currentManagerFlavor.vcpus === 4;

  if (isAlreadyResized) {
    console.log('Кластер уже имеет целевые параметры (8192MB RAM, 4 vCPUs) во всех группах');
    return { 
      dataGroup: { ram: 8192, vcpus: 4 },
      managerGroup: { ram: 8192, vcpus: 4 }
    };
  }

  // Создаем новые flavor с обновленными параметрами для каждой группы
  const newDataFlavor = {
    ...currentDataFlavor,
    ram: 8192,
    vcpus: 4,
    extra_specs: {
      ...currentDataFlavor.extra_specs
    }
  };

  const newManagerFlavor = {
    ...currentManagerFlavor,
    ram: 8192,
    vcpus: 4,
    extra_specs: {
      ...currentManagerFlavor.extra_specs
    }
  };

  console.log('Новые параметры:');
  console.log(`- Data Group: ${newDataFlavor.ram}MB RAM, ${newDataFlavor.vcpus} vCPUs`);
  console.log(`- Manager Group: ${newManagerFlavor.ram}MB RAM, ${newManagerFlavor.vcpus} vCPUs`);

  const resizePayload = {
    project_name: PROJECT_ID,
    id: orderId,
    item_id: itemId,
    order: {
      attrs: {
        data_group: {
          flavor: newDataFlavor
        },
        manager_group: {
          flavor: newManagerFlavor
        }
      }
    }
  };

  console.log('Отправляем запрос на изменение CPU/RAM для кластера...');

  const resizeResponse = await api.patch(
    `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/actions/resize_flavor_opensearch_cluster`,
    { data: resizePayload }
  );

  console.log('Статус ответа на изменение CPU/RAM:', resizeResponse.status());

  if (resizeResponse.status() !== 200) {
    const errorBody = await resizeResponse.text();
    throw new Error(`Ожидался статус 200, но получен ${resizeResponse.status()}: ${errorBody}`);
  }

  const responseData = await resizeResponse.json();
  console.log('Запрос на изменение CPU/RAM для кластера отправлен успешно');

  // Ждем завершения операции
  console.log('Ждем завершения операции изменения CPU/RAM для кластера...');

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
        `/opensearch-manager/api/v1/projects/${PROJECT_ID}/order-service/orders/${orderId}?include=last_action&with_relations=true`
      );

      const statusData = await statusResponse.json();
      
      const minutesPassed = Math.round((Date.now() - startTime) / 60000);
      console.log(`[${minutesPassed} мин] Статус заказа: ${statusData.status}`);

      // Проверяем что flavor изменился в конфигурации всех групп
      const currentManagedItem = statusData.data.find((item: any) => item.type === 'managed' && item.provider === 'opensearch_vm');
      
      if (currentManagedItem) {
        const updatedDataFlavor = currentManagedItem.data.config.flavor_cluster.data_group.flavor;
        const updatedManagerFlavor = currentManagedItem.data.config.flavor_cluster.manager_group.flavor;
        
        console.log('Текущие параметры:');
        console.log(`- Data Group: ${updatedDataFlavor.ram}MB RAM, ${updatedDataFlavor.vcpus} vCPUs`);
        console.log(`- Manager Group: ${updatedManagerFlavor.ram}MB RAM, ${updatedManagerFlavor.vcpus} vCPUs`);
        
        if (updatedDataFlavor.ram === 8192 && updatedDataFlavor.vcpus === 4 &&
            updatedManagerFlavor.ram === 8192 && updatedManagerFlavor.vcpus === 4) {
          isCompleted = true;
          console.log('Параметры CPU/RAM успешно изменены во всех группах');
          
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
        throw new Error('Операция изменения CPU/RAM для кластера завершилась ошибкой');
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
    throw new Error('Изменение CPU/RAM для кластера не завершилось за отведенное время');
  }

  console.log('Операция изменения CPU/RAM для кластера завершена успешно!');

  // Финальная проверка статуса кластера после изменения
  console.log('Проверяем статус кластера после изменения CPU/RAM...');
  await checkClusterStatus(api, PROJECT_ID, orderId, itemId, 'opensearch');

  return { 
    dataGroup: { ram: 8192, vcpus: 4 },
    managerGroup: { ram: 8192, vcpus: 4 }
  };
}




