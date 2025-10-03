import { extendMySQLDisk,addPublicIp,changeBandwidth,disablePublicIp,createMySQLUser,createMySQLDatabase,editMySQLSettings,deleteMySQLCluster } from '../../common/mysql-operations';

/**
 * Выполняет общие операции для всех типов MySQL кластеров
 */
export async function runCommonMySQLOperations(clusterData: any) {
  console.log('=== Запуск общих операций для MySQL кластера ===');
  
  // 02-mysql-extend.spec.ts Увеличение диска
  console.log('\n Увеличение диска ---');
  await extendMySQLDisk(clusterData.orderId, clusterData.itemId);
  
  // 03-mysql-public-ip.spec Подключение Public IP
  console.log('\n Подключение Public IP ---');
  await addPublicIp(clusterData.orderId, clusterData.itemId);
  
  // 04-mysql-change-bandwidth.spec Изменение bandwidth
  console.log('\n Изменение bandwidth ---');
  await changeBandwidth(clusterData.orderId, clusterData.itemId);
  
  // 05-mysql-disable-public-ip.spec.ts Отключение Public IP
  console.log('\n   Отключение Public IP ---');
  await disablePublicIp(clusterData.orderId, clusterData.itemId);
  
  // 06-mysql-create-user.spec.ts Создание пользователя
  console.log('\n Создание пользователя ---');
  await createMySQLUser(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
  
  // 07-mysql-db-create.spec.ts Создание базы данных
  console.log('\n bСоздание базы данных ---');
  await createMySQLDatabase(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
  
  // 08-mysql-edit-vm-settings.spec.ts Изменение настроек
  console.log('\n Изменение настроек ---');
  await editMySQLSettings(clusterData.orderId, clusterData.itemId);

  console.log('=== Все тесты завершены! ===');
}

