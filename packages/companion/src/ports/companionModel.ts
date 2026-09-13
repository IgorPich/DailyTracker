export interface TrainerExtractionRequest {
  readonly text: string
  readonly exercises: readonly { readonly id: string; readonly name: string }[]
}

/** No persistence, commands or tools are provided to the model. Output is always untrusted. */
export interface CompanionModel<Request = TrainerExtractionRequest> {
  propose(request: Request): Promise<unknown>
}
