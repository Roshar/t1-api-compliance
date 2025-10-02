import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createMySQLCluster } from '../../common/mysql-operations';
import { testData } from '../../common/test-data';

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Создание MySQL standalone кластера', async () => {
  const clusterData = await createMySQLCluster();
  // Сохраняем в testData для других тестов
  testData.mysqlCluster = clusterData;
});