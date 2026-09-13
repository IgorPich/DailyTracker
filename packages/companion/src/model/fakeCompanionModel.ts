import type { CompanionModel, TrainerExtractionRequest } from '../ports/companionModel.ts'

/** A configured response, not a parser or an imitation of intelligence. */
export class FakeCompanionModel implements CompanionModel {
  private readonly output: unknown
  constructor(output: unknown) { this.output = structuredClone(output) }
  async propose(_request: TrainerExtractionRequest): Promise<unknown> { return structuredClone(this.output) }
}
