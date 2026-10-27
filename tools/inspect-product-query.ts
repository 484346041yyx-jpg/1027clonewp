import { loadConfig, redactor } from '../src/core/config.js';
import { writeJson } from '../src/core/files.js';
import { WordPressClient } from '../src/wordpress/client.js';
const root = 'D:/cloneWP';
const {config, credentials} = await loadConfig(root);
const client = new WordPressClient({targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password});
try {
  const proof = await client.readNativeProductQuerySourceProof();
  await writeJson('D:/cloneWP/.cache/native-product-query-source.json', proof);
  console.log(JSON.stringify({targetOrigin: proof.targetOrigin, sources: proof.sources.map(({name, sha256}) => ({name, sha256})), readOnly: true}));
} catch (error) {console.error(redactor(credentials)(error)); process.exitCode = 1;} finally {await client.close();}
