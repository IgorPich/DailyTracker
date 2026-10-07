import { argumentValue, validateGitHubReleaseOrder } from './release-lib.mjs'
import policy from './release-policy.json' with { type: 'json' }

const candidateTag = argumentValue('--candidate-tag')
const repository = argumentValue('--repository')
const token = process.env.GH_TOKEN
if (!token) throw new Error('GH_TOKEN is required to validate GitHub release ordering.')

const request = async (path) => {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'GreekGod-stable-release',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  let body
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  return { status: response.status, body }
}

const latestResponse = await request('/releases/latest')
let releasesResponse
if (latestResponse.status === 404) {
  const releases = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await request(`/releases?per_page=100&page=${page}`)
    if (response.status !== 200 || !Array.isArray(response.body)) {
      releasesResponse = response
      break
    }
    releases.push(...response.body)
    if (response.body.length < 100) {
      releasesResponse = { status: 200, body: releases }
      break
    }
  }
  if (!releasesResponse) throw new Error('GitHub release listing exceeded 100 pages.')
}
const result = validateGitHubReleaseOrder({ candidateTag, latestResponse, releasesResponse, policy })
process.stdout.write(`PASS ${result.mode} release order: ${result.candidate} > ${result.current}\n`)
