const AWS = require('aws-sdk');

const name = "cognitoClientSecrets-frontend";
// Lambda@Edge runs in us-east-1 but needs to access secrets in the deployment region
// We'll try multiple regions to find the secret
const regions = ['us-west-2', 'us-east-1', 'eu-central-1', 'ap-northeast-1', 'ap-southeast-1'];

let secretsCache = null;


const getSecrets = async () => {
  if (secretsCache) {
    return secretsCache;
  }
  
  // Try each region until we find the secret
  for (const region of regions) {
    try {
      const secretsManager = new AWS.SecretsManager({ region });
      const secrets = await getSecretsInternal(secretsManager);
      secretsCache = secrets;
      return secrets;
    } catch (error) {
      console.log(`Failed to get secrets from region ${region}:`, error.message);
      continue;
    }
  }
  
  throw new Error('Could not retrieve secrets from any region');
}

const getSecretsInternal = async client => {
  return new Promise((resolve, reject) => {
    client.getSecretValue({ SecretId: name }, (err, data) => {
      if (err) {
        switch (err.code) {
          case 'DecryptionFailureException':
            console.error(`Secrets Manager can't decrypt the protected secret text using the provided KMS key.`)
            break
          case 'InternalServiceErrorException':
            console.error(`An error occurred on the server side.`)
            break
          case 'InvalidParameterException':
            console.error(`You provided an invalid value for a parameter.`)
            break
          case 'InvalidRequestException':
            console.error(`You provided a parameter value that is not valid for the current state of the resource.`)
            break
          case 'ResourceNotFoundException':
            console.error(`We can't find the resource that you asked for.`)
            break
        }
        console.error(err)
        reject(err)
        return
      }

      // Decrypts secret using the associated KMS CMK.
      // Depending on whether the secret is a string or binary, one of these fields will be populated.
      let secrets;
      if ('SecretString' in data) {
        secrets = data.SecretString;
      } else {
        const buff = Buffer.from(data.SecretBinary, 'base64');
        secrets = buff.toString('ascii');
      }

      resolve(JSON.parse(secrets))
    })
  })
}

module.exports = {
  getSecrets,
}