import { resolve } from 'node:path'
import { argumentValue, repositoryRoot } from './release-lib.mjs'
import { validateReleaseAssets } from './release-assets-lib.mjs'
import policy from './release-policy.json' with { type: 'json' }

const result = validateReleaseAssets({
  tag: argumentValue('--tag'),
  repository: argumentValue('--repository'),
  directory: resolve(repositoryRoot, argumentValue('--directory')),
  platformKeys: policy.manifestPlatformKeys,
})
process.stdout.write(`PASS release assets ${result.version}: ${result.installerName}, ${result.signatureName}, ${result.manifestName}\n`)
