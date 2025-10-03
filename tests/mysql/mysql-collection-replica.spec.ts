import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createMySQLCluster, addMySQLNode, deleteMySQLCluster} from '../../common/mysql-operations';
import { runCommonMySQLOperations} from './mysql-collection-shared';

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test.describe.serial('MySQL full collection for replica', () => {
test('Тестирование MySQL replica', async () => {
  test.setTimeout(90 * 60 * 1000);
  try {
    console.log('=== Начало полного цикла MySQL Replica ===');
    
    const clusterData = await createMySQLCluster('mysql-replica');
    
    await runCommonMySQLOperations(clusterData);
    
    console.log('\n Добавление ноды в кластер ---');
    await addMySQLNode(clusterData.orderId, clusterData.itemId);
    await deleteMySQLCluster(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
    
  } catch (error) {
    console.error('Ошибка в тесте:', error);
    throw error; 
  }
});
});