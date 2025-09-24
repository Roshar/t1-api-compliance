const region1 = {
    getRegion: () => ({
      id: "0c530dd3-eaae-4216-8f9d-9b5710a7cc30",
      name: "ru-central1",
      description: ""
    }),
  
    getAvailabilityZone: () => ({
      id: "d3p1k01",
      name: "ru-central1-a",
      description: ""
    }),
  
    getSubnet: () => ({
      name: "default-ru-central1",
      id: "5f344f27-4af8-4e57-b56a-bd8787647b01",
      network: {
        name: "default",
        status: "available",
        id: "91f0b64a-ddc7-4627-b501-826ef61a296a",
        description: "Предварительно созданная сеть.",
        create_time: "2025-07-23T16:59:43.699263",
        shared_from: null
      }
    }),
  
    getFlavor: () => ({
      id: "c85dd16b-25c8-4ecf-9306-1fd2ebf2d9ce",
      name: "b2.large.1",
      description: null,
      ram: 2048,
      vcpus: 2,
      gpus: 0,
      extra_specs: {
        family: "general-purpose",
        series: "Intel Cascade Lake 2.2 GHz",
        hardware_group: "public"
      }
    }),
  
    getBootVolume: () => ({
      size: 25,
      volume_type: {
        id: "076482c0-0367-4dee-a16f-2c6673a97f7f",
        name: "dorado-sp07",
        extra_specs: {
          disk_type: "High cluster 4",
          max_read_iops: 15000,
          max_write_iops: 5000
        }
      }
    })
  };
  

  const region2 = {
    getRegion: () => ({
      id: "02d93c85-e2b8-4708-bb16-1cff29f30af1",
      name: "ru-central2",
      description: ""
    }),
  
    getAvailabilityZone: () => ({
      id: "d4p1",
      name: "ru-central2-a",
      description: ""
    }),
  
    getSubnet: () => ({
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
    }),
  
    getFlavor: () => ({
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
    }),
  
    getBootVolume: () => ({
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
    })
  };



//Используем регион 1
  export const regName = 'region-1';
  export const selectedRegion = region1; 

//Используем регион 2
// export const selectedRegion = region2; // Используем регион 2
// export const regName = 'region-2';
  