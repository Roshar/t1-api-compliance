import { OrderData } from '../OrderData';
import { selectedRegion, regName } from '../RegionSelector';

export class OpenSearchClusterNodeData extends OrderData {
  protected getParameters() {
    throw new Error('Method not implemented.');
  }
  protected productType = 'opensearch';
  
  buildOrderBody() {
    const dataFlavor = selectedRegion.getFlavor();
    const dataBootVolume = selectedRegion.getBootVolume();
    const managerFlavor = selectedRegion.getFlavor();
    const managerBootVolume = selectedRegion.getBootVolume();
    
    return {
      order: {
        attrs: {
          creator: this.getCreator(),
          public_ip: false,
          cluster_name: this.generateClusterName('opensearch-cluster'),
          cluster_description: `OpenSearch cluster (1-1-0) AT ${regName}`,
          opensearch_version: '2.18.0',
          number_of_vms: 2, // Data (1) + Manager (1) = 2 ноды
          region: selectedRegion.getRegion(),
          availability_zone: selectedRegion.getAvailabilityZone(),
          subnet: selectedRegion.getSubnet(),
          flavor: {}, // ← ПУСТОЙ для Cluster типа!
          boot_volume: {}, // ← ПУСТОЙ для Cluster типа!
          service_type: 'Cluster', // Важно: 'Cluster' вместо 'Single-Node'
          flavor_cluster: {
            data_group: {
              number_of_vms: 1,
              flavor: dataFlavor,
              boot_volume: dataBootVolume
            },
            manager_group: {
              number_of_vms: 1,
              flavor: managerFlavor, 
              boot_volume: managerBootVolume
            },
            dashboard_group: {
              number_of_vms: 0,
              public_ip: false,
              flavor: {},
              boot_volume: {}
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