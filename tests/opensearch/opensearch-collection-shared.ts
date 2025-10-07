import { 
  extendDisk, 
  extendOpenSearchClusterDisk,
  addPublicIp,
  changeBandwidth, 
  disablePublicIp,
  createUser, 
  resizeFlavor,
  addPublicIpCluster,
  changeBandwidthCluster,
  disablePublicIpCluster,
  resizeOpenSearchClusterFlavor
} from '../../common/opensearch-operations';

/**
 * Выполняет общие операции для всех типов OpenSearch кластеров
 */
export async function runCommonOpensearchOperations(clusterData: any) {
  console.log('=== Запуск общих операций для Opensearch кластера ===');
  
  // // Определяем тип операции для диска в зависимости от типа кластера
  // let diskOperation;
  // switch (clusterData.productType) {
  //   case 'opensearch-cluster':
  //     diskOperation = extendOpenSearchClusterDisk;
  //     break;
  //   case 'opensearch-single':
  //     diskOperation = extendDisk;
  //   // case 'opensearch-dashboard':
  //   //   diskOperation = extendOpenSearchDashboardDisk;
  //   default:
  //      diskOperation = extendDisk;
  //     break;
  // }
  
  // 02-Увеличение диска
  console.log('\n Увеличение диска ---');
  await extendDisk(clusterData.orderId, clusterData.itemId);
  
  // Остальные операции остаются без изменений
  // 03-Подключение Public IP
  console.log('\n Подключение Public IP ---');
  await addPublicIp(clusterData.orderId, clusterData.itemId);
  
  // 04-Изменение bandwidth
  console.log('\n Изменение bandwidth ---');
  await changeBandwidth(clusterData.orderId, clusterData.itemId);
  
  // 05-Отключение Public IP
  console.log('\n  Отключение Public IP ---');
  await disablePublicIp(clusterData.orderId, clusterData.itemId);
  
  // 06-Создание пользователя
  console.log('\n Создание пользователя ---');
  await createUser(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
  
  // 07-Изменение CPU b RAM
  console.log('\n Изменение CPU и RAM ---');
  await resizeFlavor(clusterData.orderId, clusterData.itemId);
 
  console.log('=== Все тесты завершены! ===');
}

export async function runCommonOpensearchClusterOperations(clusterData: any) {
  console.log('=== Запуск общих операций для Opensearch кластера ===');
  
  // 02-Увеличение диска
  console.log('\n Увеличение диска ---');
  await extendOpenSearchClusterDisk(clusterData.orderId, clusterData.itemId);
  
  // Остальные операции остаются без изменений
  // 03-Подключение Public IP
  console.log('\n Подключение Public IP ---');
  await addPublicIpCluster(clusterData.orderId, clusterData.itemId);
  
  // 04-Изменение bandwidth
  console.log('\n Изменение bandwidth ---');
  await changeBandwidthCluster(clusterData.orderId, clusterData.itemId);
  
  // 05-Отключение Public IP
  console.log('\n  Отключение Public IP ---');
  await disablePublicIpCluster(clusterData.orderId, clusterData.itemId);
  
  // 06-Создание пользователя
  console.log('\n Создание пользователя ---');
  await createUser(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
  
  // 07-Изменение CPU b RAM
  console.log('\n Изменение CPU и RAM ---');
  await resizeOpenSearchClusterFlavor(clusterData.orderId, clusterData.itemId);
 
  console.log('=== Все тесты завершены! ===');
}