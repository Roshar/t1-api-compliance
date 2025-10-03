import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createCluster, deleteCluster} from '../../common/redis-operations';
import { runCommonRedisOperations} from './redis-collection-shared';


test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test.describe.serial('Redis full collection for standalone', () => {
  test('Тестирование Redis standalone', async () => {
    test.setTimeout(60 * 60 * 1000); 
    try{
      console.log('=== Начало полного цикла Redis Standalone ===');
      const clusterData = await createCluster('redis-standalone');
      await runCommonRedisOperations(clusterData)
      await deleteCluster(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
     
    }catch (error) {
      console.error('Ошибка в тесте:', error);
      throw error; 
  }
    
  });
});

