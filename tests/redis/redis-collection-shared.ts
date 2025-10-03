import { extendDisk,addPublicIp,changeBandwidth,disablePublicIp,createUser,createBackup,editSettings } from '../../common/redis-operations';

/**
 * Выполняет общие операции для всех типов MySQL кластеров
 */
export async function runCommonRedisOperations(clusterData: any) {
  console.log('=== Запуск общих операций для Redis кластера ===');
  
  // 02-Увеличение диска
  console.log('\n Увеличение диска ---');
  await extendDisk(clusterData.orderId, clusterData.itemId);
  
  // 03-Подключение Public IP
  console.log('\n Подключение Public IP ---');
  await addPublicIp(clusterData.orderId, clusterData.itemId);
  
  // 04-Изменение bandwidth
  console.log('\n Изменение bandwidth ---');
  await changeBandwidth(clusterData.orderId, clusterData.itemId);
  
  // 05-Отключение Public IP
  console.log('\n   Отключение Public IP ---');
  await disablePublicIp(clusterData.orderId, clusterData.itemId);
  
  // 06-Создание пользователя
  console.log('\n Создание пользователя ---');
  await createUser(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
  
  // 07-Создание базы данных
  console.log('\n bСоздание базы данных ---');
  await createBackup(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
  
  // 08-Изменение настроек
  console.log('\n Изменение настроек ---');
  await editSettings(clusterData.orderId, clusterData.itemId);

  console.log('=== Все тесты завершены! ===');
}

