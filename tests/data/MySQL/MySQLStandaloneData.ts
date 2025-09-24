import { OrderData } from '../OrderData';
import {selectedRegion, regName} from '../RegionSelector';

export class MySQLStandaloneData extends OrderData {
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
          cluster_description: `MySQL standalone AT ${regName}`,
          mysql_version: '8.4.4',
          number_of_vms: 1,
          region: selectedRegion.getRegion(),
          availability_zone: selectedRegion.getAvailabilityZone(),
          subnet: selectedRegion.getSubnet(),
          flavor: selectedRegion.getFlavor(),
          boot_volume: selectedRegion.getBootVolume(),
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

}
