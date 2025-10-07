import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createCluster, deleteCluster} from '../../common/opensearch-operations';
import { runCommonOpensearchOperations} from './opensearch-collection-shared';


test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test.describe.serial('Opensearch full collection for singleNode', () => {
  test('Тестирование opensearch SingleNode', async () => {
    test.setTimeout(60 * 60 * 1000); 
    try{
      console.log('=== Начало полного цикла opensearch SingleNode ===');
      const clusterData = await createCluster('opensearch-single');
      await runCommonOpensearchOperations(clusterData)
      await deleteCluster(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
     
    }catch (error) {
      console.error('Ошибка в тесте:', error);
      throw error; 
  }
    
  });
});

