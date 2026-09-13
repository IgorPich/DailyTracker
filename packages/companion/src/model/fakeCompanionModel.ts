import type { CompanionModel, TrainerExtractionRequest } from '../ports/companionModel.ts'

/** A configured response, not a parser or an imitation of intelligence. */
export class FakeCompanionModel<Request = TrainerExtractionRequest> implements CompanionModel<Request> {
  private readonly output: unknown
  constructor(output: unknown) { this.output = structuredClone(output) }
  async propose(_request: Request): Promise<unknown> { return structuredClone(this.output) }
}
