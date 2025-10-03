import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createCluster } from '../../common/redis-operations';
import { testData } from '../../common/test-data';

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Создание Redis standalone кластера', async () => {
  const clusterData = await createCluster();
  // Сохраняем в testData для других тестов
  testData.cluster = clusterData;
});