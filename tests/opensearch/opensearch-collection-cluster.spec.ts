import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createCluster, deleteCluster, addOpenSearchNode} from '../../common/opensearch-operations';
import { runCommonOpensearchClusterOperations} from './opensearch-collection-shared';


test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test.describe.serial('Opensearch full collection for cluster', () => {
  test('Тестирование opensearch cluster', async () => {
    test.setTimeout(60 * 60 * 1000); 
    try{
      console.log('=== Начало полного цикла opensearch cluster ===');
      const clusterData = await createCluster('opensearch-cluster');
      await runCommonOpensearchClusterOperations(clusterData)
      await addOpenSearchNode(clusterData.orderId, clusterData.itemId, 1, 2, 0)
      await deleteCluster(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
     
    }catch (error) {
      console.error('Ошибка в тесте:', error);
      throw error; 
  }
    
  });
});

