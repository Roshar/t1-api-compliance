import { APIRequestContext } from '@playwright/test';

/**
 * Проверка статуса кластера
 */
export async function checkClusterStatus(
  api: APIRequestContext, 
  projectId: string, 
  orderId: string, 
  itemId: string
): Promise<void> {
  
  console.log('Проверяем статус кластера...');

  // 1 Инфа о заказе
  const orderResponse = await api.get(
    `/mysql-manager/api/v1/projects/${projectId}/order-service/orders/${orderId}?include=last_action&with_relations=true`
  );
  
  const orderData = await orderResponse.json();
  
  // Ищем managed item 
  // Ищем instance item 
  const managedItem = orderData.data.find((item: any) => item.type === 'managed' && item.provider === 'mysql_vm');
  const instanceItem = orderData.data.find((item: any) => item.type === 'instance' && item.parent === itemId);

  if (!managedItem) {
    throw new Error('Не найден managed item в заказе');
  }

  if (!instanceItem) {
    throw new Error('Не найден instance item в заказе');
  }

  const instanceId = instanceItem.item_id;
  console.log('Найден instance ID:', instanceId);

  // 2 Запрашиваем статус кластера
  const statusResponse = await api.get(
    `/mysql-manager/api/v1/projects/${projectId}/instances/${instanceId}:get-service-status`
  );

  // Проверяем что запрос принят
  if (statusResponse.status() !== 202) {
    throw new Error(`Ошибка при запросе статуса: ${statusResponse.status()}`);
  }

  const statusData = await statusResponse.json();
  
  // Извлекаем ID команды из URL
  const commandId = statusData.url.split('/').pop();
  console.log('Command ID для проверки статуса:', commandId);

  // 4 Получаем результат команды
  const commandResponse = await api.get(
    `/mysql-manager/api/v1/projects/${projectId}/commands/${commandId}`
  );
  
  if (commandResponse.status() !== 200) {
    throw new Error(`Ошибка при получении результата команды: ${commandResponse.status()}`);
  }

  const commandData = await commandResponse.json();

//    Для отладки
//   console.log('Результат проверки статуса:');
//   console.log('- Статус команды:', commandData.status);
//   console.log('- Статус сервиса:', commandData.response?.status);
//   console.log('- Активен:', commandData.response?.is_active);

  // Проверка готовности кластера для зауска действия
  if (commandData.status !== 'success') {
    throw new Error(`Команда проверки статуса не выполнена: ${commandData.status}`);
  }

  if (commandData.response?.status !== 'active') {
    throw new Error(`Кластер не в активном состоянии: ${commandData.response?.status}`);
  }

  if (!commandData.response?.is_active) {
    throw new Error('Кластер не активен (is_active: false)');
  }

  console.log('Кластер активен и готов к операциям');
}