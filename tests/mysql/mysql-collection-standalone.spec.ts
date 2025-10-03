import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createMySQLCluster, extendMySQLDisk, addPublicIp, changeBandwidth, disablePublicIp,createMySQLUser, createMySQLDatabase, editMySQLSettings,deleteMySQLCluster } from '../../common/mysql-operations';
import { runCommonMySQLOperations} from './mysql-collection-shared';

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test.describe.serial('MySQL full collection for standalone', () => {
  test('Тестирование MySQL standalone', async () => {
    test.setTimeout(60 * 60 * 1000); 
    try{
      console.log('=== Начало полного цикла MySQL Standalone ===');
      const clusterData = await createMySQLCluster('mysql-standalone');
      await runCommonMySQLOperations(clusterData);
      await deleteMySQLCluster(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
    }catch (error) {
      console.error('Ошибка в тесте:', error);
      throw error; 
  }
    
  });
});

