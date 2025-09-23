import { RedisOrderData } from './RedisOrderData';
import { MySQLOrderData } from './MySQLOrderData';
import { OrderData } from './OrderData';

export type ProductType = 'redis' | 'mysql' | 'opensearch';

export class OrderDataFactory {
  static createOrderData(productType: ProductType): OrderData {
    switch (productType) {
      case 'redis':
        return new RedisOrderData();
      case 'mysql':
        return new MySQLOrderData();
      default:
        throw new Error(`Unsupported product type: ${productType}`);
    }
  }
}


