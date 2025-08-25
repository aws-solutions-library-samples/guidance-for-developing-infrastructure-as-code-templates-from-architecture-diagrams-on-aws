const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const name = "cognitoClientSecrets-frontend";
const primarySecretManager = new SecretsManagerClient({
  region: 'us-east-1', // Lambda@Edge always runs in us-east-1
});


const getSecrets = async () => {
  let secrets;
  secrets = await getSecretsInternal(primarySecretManager)
  return secrets
}

const getSecretsInternal = async client => {
  try {
    const command = new GetSecretValueCommand({ SecretId: name });
    const data = await client.send(command);
    
    let secrets;
    if (data.SecretString) {
      secrets = data.SecretString;
    } else {
      const buff = Buffer.from(data.SecretBinary, 'base64');
      secrets = buff.toString('ascii');
    }
    
    return JSON.parse(secrets);
  } catch (err) {
    console.error('Error retrieving secret:', err);
    throw err;
  }
}

module.exports = {
  getSecrets,
}