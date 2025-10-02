import { test } from '@playwright/test';
import 'dotenv/config';
import { setupAPIContext, disposeAPIContext } from '../../common/api-context';
import { createMySQLCluster, extendMySQLDisk, addPublicIp, changeBandwidth, disablePublicIp,createMySQLUser, createMySQLDatabase, editMySQLSettings,deleteMySQLCluster } from '../../common/mysql-operations';

test.beforeAll(async () => {
  await setupAPIContext();
});

test.afterAll(async () => {
  await disposeAPIContext();
});

test.describe.serial('MySQL Full Collection', () => {
  test('Полный цикл MySQL операций', async () => {
    test.setTimeout(60 * 60 * 1000); 
    
    const clusterData = await createMySQLCluster();
    await extendMySQLDisk(clusterData.orderId, clusterData.itemId);
    await addPublicIp(clusterData.orderId, clusterData.itemId)
    await changeBandwidth(clusterData.orderId, clusterData.itemId)
    await disablePublicIp(clusterData.orderId, clusterData.itemId)
    await createMySQLUser(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
    await createMySQLDatabase(clusterData.orderId, clusterData.itemId, clusterData.clusterName);
    await editMySQLSettings(clusterData.orderId, clusterData.itemId);
    await deleteMySQLCluster(clusterData.orderId, clusterData.itemId, clusterData.clusterName);


    
  });
});