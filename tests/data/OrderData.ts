export abstract class OrderData {
  protected abstract productType: string;
  
  // Общие методы для всех продуктов
  protected generateClusterName(prefix: string): string {
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${prefix}-${suffix}`;
  }

  protected getCreator() {
    return {
      email: "rbatukaev@t1.ru",
      id: "d1ace1b2-6094-41d2-bc7d-46812f7c7884",
      realm: ""
    };
  }

  protected getMaintenanceWindow() {
    return {
      day: 0,
      time_range: "00:00 - 01:00"
    };
  }

  protected getSecurityGroups() {
    return [
      {
        id: "c79066a7-2ce8-4dbb-ae8e-70b51ecf4fee",
        name: "rbatukaev"
      }
    ];
  }

  // Абстрактные методы - тут оставим реализацию для каждого продукта по своему 
  //TODO продумать для кластеров с несколькими ВМ
  protected abstract getRegion(): any;
  protected abstract getAvailabilityZone(): any;
  protected abstract getSubnet(): any;
  protected abstract getFlavor(): any;
  protected abstract getBootVolume(): any;
  protected abstract getParameters(): any;
  
  // Для формирования тела зказа 
  abstract buildOrderBody(): any;
}