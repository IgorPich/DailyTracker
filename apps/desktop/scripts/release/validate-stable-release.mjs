import { argumentValue, loadProductionPolicyState, validatePolicyState } from './release-lib.mjs'

const tag = argumentValue('--tag')
const version = validatePolicyState({ tag, ...loadProductionPolicyState() })
process.stdout.write(`PASS stable release policy for ${version}\n`)
