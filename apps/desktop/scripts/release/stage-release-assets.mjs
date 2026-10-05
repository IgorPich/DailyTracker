import { resolve } from 'node:path'
import { argumentValue, repositoryRoot } from './release-lib.mjs'
import { stageReleaseAssets } from './release-assets-lib.mjs'
import policy from './release-policy.json' with { type: 'json' }

const result = stageReleaseAssets({
  tag: argumentValue('--tag'),
  repository: argumentValue('--repository'),
  bundleDirectory: resolve(repositoryRoot, argumentValue('--bundle-dir')),
  outputDirectory: resolve(repositoryRoot, argumentValue('--output')),
  platformKeys: policy.manifestPlatformKeys,
})
process.stdout.write(`PASS staged ${result.installerName}, ${result.signatureName}, latest.json\n`)
