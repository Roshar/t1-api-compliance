/**
 * Файл для обмена данными между тестами
 * 
 * Здесь храним информацию о созданных ресурсах, чтобы передавать 
 * между разными тестовыми файлами, если собираемся по цепочке вызывать
 */

export interface CreatedCluster {
  orderId: string;      
  itemId: string;       
  clusterName: string;  
}

export const testData = {
  //mysqlCluster: null as CreatedCluster | null
  cluster: null as CreatedCluster | null
};