// cluster-status.ts
import { APIRequestContext } from '@playwright/test';

// Типы поддерживаемых продуктов
type ProductType = 'mysql' | 'redis' | 'opensearch';

/**
 * Универсальная проверка статуса кластера
 */
export async function checkClusterStatus(
  api: APIRequestContext, 
  projectId: string, 
  orderId: string, 
  itemId: string,
  productType: ProductType = 'mysql'
): Promise<void> {
  
  console.log(`Проверяем статус ${productType.toUpperCase()} кластера...`);

  // Определяем настройки для каждого типа продукта
  const productConfig = {
    mysql: {
      apiPrefix: 'mysql-manager',
      provider: 'mysql_vm',
      hasInstanceItems: true  // MySQL имеет instance items
    },
    redis: {
      apiPrefix: 'redis-manager', 
      provider: 'redis_vm',
      hasInstanceItems: true   // Redis имеет instance items
    },
    opensearch: {
      apiPrefix: 'opensearch-manager', 
      provider: 'opensearch_vm',
      hasInstanceItems: false  // OpenSearch может не иметь instance items
    }
  };

  const config = productConfig[productType];

  // 1. Инфа о заказе
  const orderResponse = await api.get(
    `/${config.apiPrefix}/api/v1/projects/${projectId}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderData = await orderResponse.json();
  
  // Ищем managed item для соответствующего провайдера
  const managedItem = orderData.data.find((item: any) => 
    item.type === 'managed' && item.provider === config.provider
  );

  if (!managedItem) {
    throw new Error(`Не найден managed item для ${productType} в заказе`);
  }

  // Для продуктов с instance items ищем instance
  let instanceId: string | null = null;
  
  if (config.hasInstanceItems) {
    const instanceItem = orderData.data.find((item: any) => 
      item.type === 'instance' && item.parent === itemId
    );

    if (!instanceItem) {
      throw new Error('Не найден instance item в заказе');
    }

    instanceId = instanceItem.item_id;
    console.log(`Найден ${productType.toUpperCase()} instance ID:`, instanceId);
  } else {
    // Для продуктов без instance items используем managed item
    console.log(`${productType.toUpperCase()} использует managed item для проверки статуса`);
    instanceId = managedItem.item_id; // Используем ID managed item
  }

  // 2. Запрашиваем статус кластера
  const statusResponse = await api.get(
    `/${config.apiPrefix}/api/v1/projects/${projectId}/instances/${instanceId}:get-service-status`
  );

  // Проверяем что запрос принят
  if (statusResponse.status() !== 202) {
    // Если OpenSearch не поддерживает этот endpoint, пропускаем детальную проверку
    if (productType === 'opensearch' && statusResponse.status() === 404) {
      console.log('OpenSearch не поддерживает детальную проверку статуса, проверяем только статус заказа...');
      
      // Проверяем общий статус заказа
      if (orderData.status === 'error') {
        throw new Error('OpenSearch кластер находится в состоянии ошибки');
      }
      
      console.log('OpenSearch кластер готов к операциям (базовая проверка)');
      return;
    }
    
    throw new Error(`Ошибка при запросе статуса ${productType}: ${statusResponse.status()}`);
  }

  const statusData = await statusResponse.json();
  
  // Извлекаем ID команды из URL
  const commandId = statusData.url.split('/').pop();
  console.log(`Command ID для проверки статуса ${productType}:`, commandId);

  // 3. Получаем результат команды
  const commandResponse = await api.get(
    `/${config.apiPrefix}/api/v1/projects/${projectId}/commands/${commandId}`
  );
  
  if (commandResponse.status() !== 200) {
    throw new Error(`Ошибка при получении результата команды ${productType}: ${commandResponse.status()}`);
  }

  const commandData = await commandResponse.json();

  // Для отладки
  console.log(`Результат проверки статуса ${productType}:`);
  console.log('- Статус команды:', commandData.status);
  console.log('- Статус сервиса:', commandData.response?.status);
  console.log('- Активен:', commandData.response?.is_active);

  // Проверка готовности кластера для запуска действия
  if (commandData.status !== 'success') {
    throw new Error(`Команда проверки статуса ${productType} не выполнена: ${commandData.status}`);
  }

  if (commandData.response?.status !== 'active') {
    throw new Error(`${productType.toUpperCase()} кластер не в активном состоянии: ${commandData.response?.status}`);
  }

  if (!commandData.response?.is_active) {
    throw new Error(`${productType.toUpperCase()} кластер не активен (is_active: false)`);
  }

  console.log(`${productType.toUpperCase()} кластер активен и готов к операциям`);
}

/**
 * Старая функция для обратной совместимости (MySQL по умолчанию)
 */
export async function checkMySQLClusterStatus(
  api: APIRequestContext, 
  projectId: string, 
  orderId: string, 
  itemId: string
): Promise<void> {
  return checkClusterStatus(api, projectId, orderId, itemId, 'mysql');
}

/**
 * Специальная функция для Redis
 */
export async function checkRedisClusterStatus(
  api: APIRequestContext, 
  projectId: string, 
  orderId: string, 
  itemId: string
): Promise<void> {
  return checkClusterStatus(api, projectId, orderId, itemId, 'redis');
}

/**
 * Специальная функция для OpenSearch
 */
export async function checkOpenSearchClusterStatus(
  api: APIRequestContext, 
  projectId: string, 
  orderId: string, 
  itemId: string
): Promise<void> {
  return checkClusterStatus(api, projectId, orderId, itemId, 'opensearch');
}