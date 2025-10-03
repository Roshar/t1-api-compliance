import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { testData } from '../../common/test-data'; 
import { deleteMySQLCluster } from '../../common/mysql-operations';

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

// В 09-mysql-delete-cluster.spec.ts
test('Удаление MySQL кластера', async () => {
  test.setTimeout(30 * 60 * 1000);

  if (!testData.cluster) {
    console.log('Нет данных кластера для удаления, пропускаем тест');
    test.skip();
    return;
  }

  const { orderId, itemId, clusterName } = testData.cluster;
  await deleteMySQLCluster(orderId, itemId, clusterName);
  
  // Очищаем данные из testData после удаления (в тесте, а не в функции)
  testData.cluster = null;
  console.log('Данные кластера очищены из testData');
});