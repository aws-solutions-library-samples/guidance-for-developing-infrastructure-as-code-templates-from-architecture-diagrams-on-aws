type VpcType = 'NO_VPC' | 'VPC' | 'VPC_FROM_LOOK_UP'

interface IVpcConfigBase {
  type: VpcType;
}

export interface IVpcConfigNoVpc extends IVpcConfigBase {
  type: 'NO_VPC';
}

export interface IVpcConfigNewVpc extends IVpcConfigBase {
  type: 'VPC';
  cidrBlock: string;
  subnetCidrMask: number;
}

interface IVpcConfigFromLookUp extends IVpcConfigBase {
  type: 'VPC_FROM_LOOK_UP';
  vpcId: string;
}

export type IVpcStackConfig = IVpcConfigNoVpc| IVpcConfigNewVpc | IVpcConfigFromLookUp

export class VpcConfig {
  static readonly NO_VPC: IVpcConfigNoVpc = {
    type: 'NO_VPC',
  };

  static readonly VPC: IVpcConfigNewVpc = {
    type: 'VPC',
    cidrBlock: '172.31.0.0/23',
    subnetCidrMask: 24,
  };

  static readonly VPC_FROM_LOOK_UP: IVpcConfigFromLookUp = {
    type: 'VPC_FROM_LOOK_UP',
    vpcId: '',
  };
}