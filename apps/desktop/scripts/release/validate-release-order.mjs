import { argumentValue, validateReleaseOrder } from './release-lib.mjs'

const result = validateReleaseOrder(argumentValue('--candidate-tag'), argumentValue('--current-tag'))
process.stdout.write(`PASS release order ${result.current} -> ${result.candidate}\n`)
