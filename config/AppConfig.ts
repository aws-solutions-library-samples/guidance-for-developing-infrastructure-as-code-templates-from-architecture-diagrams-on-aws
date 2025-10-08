import { IAppConfig } from './Types';
import { Environment } from './Utils';
import { VpcConfig } from './VpcConfig';

const region: string = Environment.getEnvVar('AWS_REGION');

export const AppConfig: IAppConfig = {
  applicationName: Environment.getEnvVar('npm_package_config_applicationName'),
  deploymentAccount: Environment.getEnvVar('AWS_ACCOUNT_ID'),
  region: region,
  vpc: VpcConfig.VPC,
};