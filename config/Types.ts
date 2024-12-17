import { IVpcStackConfig } from './VpcConfig';

export interface IAppConfig {
  applicationName: string;
  applicationQualifier: string;
  deploymentAccount: string;
  region: string;
  vpc: IVpcStackConfig;
}

export interface ICodeCommitConfig {
  name: string;
  description: string;
  branch: string;
}
