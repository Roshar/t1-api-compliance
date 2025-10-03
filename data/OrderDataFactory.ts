import { RedisStandaloneData } from './Redis/RedisStandaloneData';
import { RedisSentinelData } from './Redis/RedisSentinelData';
import { MySQLStandaloneData } from './MySQL/MySQLStandaloneData';
import { MySQLReplicaData } from './MySQL/MySQLReplicaData';
import { OrderData } from './OrderData';

export type ProductType = 
  | 'redis-standalone' | 'redis-sentinel' | 'redis-cluster'
  | 'mysql-standalone' | 'mysql-replica' | 'mysql-cluster'
  | 'opensearch-single' | 'opensearch-cluster' | 'opensearch-dedicated';

  //TODO необходимо реализовать
  //OpenSearchSingleData
  //OpenSearchClusterWithoutDashboardData
  //OpenSearchClusterWithDashboardData

export class OrderDataFactory {
  static createOrderData(productType: ProductType): OrderData {
    switch (productType) {
      // Redis
      case 'redis-standalone':
        return new RedisStandaloneData();
      case 'redis-sentinel':
        return new RedisSentinelData();
      // MySQL
      case 'mysql-standalone':
        return new MySQLStandaloneData(); 
      case 'mysql-replica':
        return new MySQLReplicaData();  
      // Можно добавить остальные продукты по мере необходимости
      default:
        throw new Error(`Unsupported product type: ${productType}`);
    }
  }
}