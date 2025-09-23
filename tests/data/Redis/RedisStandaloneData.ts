import { OrderData } from '../OrderData';

export class RedisStandaloneData extends OrderData {
  protected productType = 'redis';

  buildOrderBody() {
    return {
      order: {
        attrs: {
          creator: this.getCreator(),
          public_ip: false,
          cluster_name: this.generateClusterName('redis-vm'),
          cluster_description: "Standalone Redis cluster for automated testing",
          redis_version: "7.2.5",
          number_of_vms: 1,
          region: this.getRegion(),
          availability_zone: this.getAvailabilityZone(),
          subnet: this.getSubnet(),
          flavor: this.getFlavor(),
          boot_volume: this.getBootVolume(),
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

  protected getRegion() {
    return {
      id: "02d93c85-e2b8-4708-bb16-1cff29f30af1",
      name: "ru-central2",
      description: ""
    };
  }

  protected getAvailabilityZone() {
    return {
      id: "d4p1",
      name: "ru-central2-a",
      description: ""
    };
  }

  protected getSubnet() {
    return {
      name: "default-ru-central2",
      id: "4293bfb7-ee13-41c9-9b86-8fe9e23148c0",
      network: {
        name: "default",
        status: "available",
        id: "91f0b64a-ddc7-4627-b501-826ef61a296a",
        description: "Предварительно созданная сеть.",
        create_time: "2025-07-23T16:59:43.699263",
        shared_from: null
      }
    };
  }

  protected getFlavor() {
    return {
      id: "b4e6d4a4-e6bb-4769-ab13-5423f51eb4f9",
      name: "b5.2xlarge.4",
      description: null,
      ram: 28672,
      vcpus: 8,
      gpus: 0,
      extra_specs: {
        family: "general-purpose",
        series: "Intel Ice lake 2.8 GHz",
        hardware_group: "public"
      }
    };
  }

  protected getBootVolume() {
    return {
      size: 25,
      volume_type: {
        id: "2207b7c5-5848-477b-9745-8cb422af1705",
        name: "average",
        extra_specs: {
          disk_type: "Average",
          max_read_iops: 10000,
          max_write_iops: 3000
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