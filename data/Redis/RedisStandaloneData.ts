import { OrderData } from '../OrderData';
import { selectedRegion, regName } from '../RegionSelector'

export class RedisStandaloneData extends OrderData {
  protected productType = 'redis';

  buildOrderBody() {
    return {
      order: {
        attrs: {
          creator: this.getCreator(),
          public_ip: false,
          cluster_name: this.generateClusterName('redis-vm'),
          cluster_description: `Standalone Redis AT ${regName}`,
          redis_version: "7.2.5",
          number_of_vms: 1,
          region: selectedRegion.getRegion(),
          availability_zone: selectedRegion.getAvailabilityZone(),
          subnet: selectedRegion.getSubnet(),
          flavor: selectedRegion.getFlavor(),
          boot_volume: selectedRegion.getBootVolume(),
          auto_backup: { enabled: false },
          parameters: this.getParameters(),
          aof: { fsync: "everysec", enabled: true },
          rdb: { save: "300 10", enabled: true, compression: true },
          security_groups: this.getSecurityGroups(),
          security_group: true,
          service_type: "Standalone",
          is_security_group_selected: true,
          maintance_window: this.getMaintenanceWindow(),
          is_only_tls: true
        }
      }
    };
  }

  protected getParameters() {
    return {
      timeout: 300,
      "tcp-backlog": 511,
      "tcp-keepalive": 300,
      "maxmemory-policy": "noeviction"
    };
  }
}