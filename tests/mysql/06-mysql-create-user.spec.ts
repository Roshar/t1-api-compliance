import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { testData } from '../../common/test-data'; 
import { createMySQLUser } from '../../common/mysql-operations';

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Создание пользователя MySQL', async () => {
  test.setTimeout(10 * 60 * 1000);

  if (!testData.mysqlCluster) {
    console.log('Кластер не создан, пропускаем тест');
    test.skip();
    return;
  }

  const { orderId, itemId, clusterName } = testData.mysqlCluster;
  const username = await createMySQLUser(orderId, itemId, clusterName);
  console.log(`Пользователь ${username} успешно создан`);
});