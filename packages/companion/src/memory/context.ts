import type { CompanionContextReader } from '../readonly/runtime.ts'
import type { CompanionMemoryReader, MemoryScope } from './memory.ts'

/** Captured explicit request scope/time, not global ambient context. No memory writer is passed. */
export const withCompanionMemory = (facts: CompanionContextReader, memory: CompanionMemoryReader,
  scope: MemoryScope, asOf: string): CompanionContextReader => {
  const requestScope = structuredClone(scope)
  return { readEvidence: async () => {
    const base = await facts.readEvidence()
    const selected = await memory.readActiveMemory(requestScope, asOf)
    return [...base, ...selected.map((item) => ({ id: `companion-memory:${item.id}`,
      text: JSON.stringify({ content: item.content, scope: item.scope, source: item.source, provenance: item.provenance }) }))]
  } }
}
