import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { testData } from '../../common/test-data'; 
import { addPublicIp } from '../../common/mysql-operations';

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test('Подключение Public IP', async () => {
  test.setTimeout(20 * 60 * 1000);

  if (!testData.cluster) {
    console.log('Кластер не создан, используем статические данные');
    test.skip();
    return;
  }

  const { orderId, itemId } = testData.cluster;
  await addPublicIp(orderId, itemId);
});