import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { testData } from '../../common/test-data'; 
import { editMySQLSettings } from '../../common/mysql-operations';

const PROJECT_ID = process.env.PROJECT_ID!;

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

// В 08-mysql-edit-vm-settings.spec.ts
test('Изменение настроек MySQL кластера', async () => {
  test.setTimeout(20 * 60 * 1000);

  if (!testData.mysqlCluster) {
    console.log('Кластер не создан, пропускаем тест');
    test.skip();
    return;
  }

  const { orderId, itemId } = testData.mysqlCluster;
  const newMaxConnections = await editMySQLSettings(orderId, itemId);
  console.log(`Настройки успешно изменены, max_user_connections = ${newMaxConnections}`);
});