import { OrderData } from '../OrderData';
import { selectedRegion, regName } from '../RegionSelector';

export class OpenSearchSingleNodeData extends OrderData {
  protected getParameters() {
    throw new Error('Method not implemented.');
  }
  protected productType = 'opensearch';
  
  buildOrderBody() {
    const flavor = selectedRegion.getFlavor();
    const bootVolume = selectedRegion.getBootVolume();
    
    return {
      order: {
        attrs: {
          creator: this.getCreator(),
          public_ip: false,
          cluster_name: this.generateClusterName('opensearch'),
          cluster_description: `OpenSearch single-node AT ${regName}`,
          opensearch_version: '2.18.0',
          number_of_vms: 1,
          region: selectedRegion.getRegion(),
          availability_zone: selectedRegion.getAvailabilityZone(),
          subnet: selectedRegion.getSubnet(),
          flavor: flavor,
          boot_volume: bootVolume,
          service_type: 'Single-Node',
          flavor_cluster: {
            data_group: {
              number_of_vms: 1,
              flavor: flavor,
              boot_volume: bootVolume
            },
            manager_group: {
              number_of_vms: 1,
              flavor: flavor,
              boot_volume: bootVolume
            },
            dashboard_group: {
              number_of_vms: 0,
              public_ip: false,
              flavor: flavor,
              boot_volume: bootVolume
            }
          },
          security_groups: this.getSecurityGroups(),
          is_security_group_selected: true,
          maintance_window: this.getMaintenanceWindow(),
          is_only_tls: true,
        },
      },
    };
  }
}