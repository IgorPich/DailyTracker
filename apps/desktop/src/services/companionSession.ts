export interface CompanionSessionEvidence {
  readonly label: string
  readonly text: string
}

export interface CompanionSessionTurn {
  readonly question: string
  readonly answer: string
  readonly evidence: readonly CompanionSessionEvidence[]
}

export interface CompanionSessionState {
  readonly turns: readonly CompanionSessionTurn[]
}

const snapshotTurn = (turn: CompanionSessionTurn): CompanionSessionTurn => Object.freeze({
  question: turn.question,
  answer: turn.answer,
  evidence: Object.freeze(turn.evidence.map((item) => Object.freeze({ label: item.label, text: item.text }))),
})

export const createCompanionSession = (): CompanionSessionState => Object.freeze({ turns: Object.freeze([]) })

export const appendCompanionSessionTurn = (
  session: CompanionSessionState,
  turn: CompanionSessionTurn,
): CompanionSessionState => Object.freeze({ turns: Object.freeze([...session.turns, snapshotTurn(turn)]) })

export const clearCompanionSession = (): CompanionSessionState => createCompanionSession()
