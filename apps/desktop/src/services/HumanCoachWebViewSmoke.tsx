import { useEffect, useState } from 'react'
import { appDataDir } from '@tauri-apps/api/path'
import { load } from '@tauri-apps/plugin-store'
import { createHumanCoach } from '@greekgod/human-coach'
import { humanCoachRepository } from './humanCoachStorage'

// Isolated entry point: never mounts AppProvider, Tracking, or Sync.
export function HumanCoachWebViewSmoke() {
  const [message, setMessage] = useState('Running isolated HumanCoach smoke')
  useEffect(() => { void (async () => {
    const path = await appDataDir()
    if (!path.replace(/\\/g, '/').replace(/\/$/, '').endsWith('/com.igorpich.formlog.humancoachsmoke')) throw new Error('Wrong smoke AppData path')
    const app = createHumanCoach(humanCoachRepository, { readExerciseIds: () => [] })
    const results = await load('human-coach-smoke-result.json', { autoSave: false })
    const previous = await results.get<string>('expected')
    let context = await app.listContext()
    let stage = 'reopened'
    if (previous === undefined) {
      if (context.items.length) throw new Error('Smoke directory must be fresh')
      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      await app.createCoachNote({ id, text: '  Synthetic trainer source\nexact whitespace  ', provenance: { sourceType: 'TRAINER_TEXT', createdAt } })
      const taskId = crypto.randomUUID()
      await app.createCoachTask({ id: taskId, title: 'Synthetic task', exerciseIds: [], provenance: { sourceType: 'TRAINER_TEXT', createdAt, sourceNoteId: id } })
      await app.acceptCoachItem({ id: taskId, acceptedAt: new Date().toISOString() })
      context = await app.listContext()
      await results.set('expected', JSON.stringify(context))
      stage = 'created'
    } else if (JSON.stringify(context) !== previous) throw new Error('Restart changed exact context')
    await results.set('result', { status: 'pass', stage, path, at: new Date().toISOString(), items: context.items.length })
    await results.save()
    setMessage(`PASS ${stage}: ${context.items.length} items`)
  })().catch((error) => setMessage(`FAIL ${String(error)}`)) }, [])
  return <div><h1>{message}</h1><button onClick={() => setMessage('PASS existing window remains usable')}>Check window responsiveness</button></div>
}
