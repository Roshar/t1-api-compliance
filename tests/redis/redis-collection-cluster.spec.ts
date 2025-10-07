import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createCluster, deleteCluster, addRedisNode} from '../../common/redis-operations';
import { runCommonRedisOperations} from './redis-collection-shared';


test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test.describe.serial('Redis full collection for cluster', () => {
  test('Тестирование Redis cluster', async () => {
    test.setTimeout(60 * 60 * 1000); 
    try{
      console.log('=== Начало полного цикла Redis cluster ===');
      const clusterData = await createCluster('redis-cluster');

      await runCommonRedisOperations(clusterData)

      // console.log('\n Добавление ноды в кластер ---');
      // await addRedisNode(clusterData.orderId, clusterData.itemId, 4);

      await deleteCluster(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
     
    }catch (error) {
      console.error('Ошибка в тесте:', error);
      throw error; 
  }
    
  });
});

