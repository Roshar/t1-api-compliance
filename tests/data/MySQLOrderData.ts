import { OrderData } from './OrderData';

export class MySQLOrderData extends OrderData {
  protected getParameters() {
    throw new Error('Method not implemented.');
  }
  protected productType = 'mysql';
  
  
  buildOrderBody() {
    return {
      order: {
        attrs: {
          creator: this.getCreator(),
          public_ip: false,
          cluster_name: this.generateClusterName('mysql-vm'),
          cluster_description: 'Standalone MySQL cluster for automated testing',
          mysql_version: '8.4.4',
          number_of_vms: 1,
          region: this.getRegion(),
          availability_zone: this.getAvailabilityZone(),
          subnet: this.getSubnet(),
          flavor: this.getFlavor(),
          boot_volume: this.getBootVolume(),
          auto_backup: { enabled: false },
          security_groups: this.getSecurityGroups(),
          security_group: true,
          service_type: 'Standalone',
          is_security_group_selected: true,
          maintance_window: this.getMaintenanceWindow(),
          is_only_tls: true,
        },
      },
    };
  }

  protected getRegion() {
    return {
      id: '02d93c85-e2b8-4708-bb16-1cff29f30af1',
      name: 'ru-central2',
      description: '',
    };
  }

  protected getAvailabilityZone() {
    return {
      id: 'd4p1',
      name: 'ru-central2-a',
      description: '',
    };
  }

  protected getSubnet() {
    return {
      name: 'default-ru-central2',
      id: '4293bfb7-ee13-41c9-9b86-8fe9e23148c0',
      network: {
        name: 'default',
        status: 'available',
        id: '91f0b64a-ddc7-4627-b501-826ef61a296a',
        description: 'Предварительно созданная сеть.',
        create_time: '2025-07-23T16:59:43.699263',
        shared_from: null,
      },
    };
  }

  protected getFlavor() {
    return {
      id: '68b0a091-c1ae-40c7-b858-b69080452427',
      name: 'b5.large.2',
      description: null,
      ram: 4096,
      vcpus: 2,
      gpus: 0,
      extra_specs: {
        family: 'general-purpose',
        series: 'Intel Ice lake 2.8 GHz',
        hardware_group: 'public',
      },
    };
  }

  protected getBootVolume() {
    return {
      size: 10,
      volume_type: {
        id: '2207b7c5-5848-477b-9745-8cb422af1705',
        name: 'average',
        extra_specs: {
          disk_type: 'Average',
          max_read_iops: 10000,
          max_write_iops: 3000,
        },
      },
    };
  }

}
