import { RedisStandaloneData } from './Redis/RedisStandaloneData';
import { RedisSentinelData } from './Redis/RedisSentinelData';
import { RedisClusterData } from './Redis/RedisClusterData';
import { MySQLStandaloneData } from './MySQL/MySQLStandaloneData';
import { MySQLReplicaData } from './MySQL/MySQLReplicaData';
import { OpenSearchSingleNodeData } from './OpenSearch/OpenSearchSingleNodeData';
import { OpenSearchClusterNodeData } from './OpenSearch/OpenSearchClusterNodeData';

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
      case 'redis-cluster':
        return new RedisClusterData();
      // MySQL
      case 'mysql-standalone':
        return new MySQLStandaloneData(); 
      case 'mysql-replica':
        return new MySQLReplicaData();  
      // OpenSearch
      case 'opensearch-single':
        return new OpenSearchSingleNodeData(); 
      case 'opensearch-cluster':
        return new OpenSearchClusterNodeData(); 
     
      // Можно добавить остальные продукты по мере необходимости
      default:
        throw new Error(`Unsupported product type: ${productType}`);
    }
  }
}