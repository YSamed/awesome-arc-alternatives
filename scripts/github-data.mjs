// Fetches stars, the latest push date, the creation date and the contributor count for
// every GitHub repo in the README table, and writes them to public/github.json. The page
// reads that file, so visitors make no GitHub API calls and never hit the anonymous rate
// limit.
//
// The deploy workflow runs it before `pnpm build`, with the workflow's GITHUB_TOKEN
// (1,000 requests per hour per repo). Each repo takes one request for its details plus
// one per 100 contributors. Run it locally with `pnpm github-data`, or pass repos
// (`pnpm github-data owner/repo ...`) to fetch only those; without a token it falls back
// to anonymous requests, limited to 60 per hour. A failed repo is skipped and never fails
// the run: the page then fetches that one repo live.
import {mkdir, readFile, writeFile} from "node:fs/promises"

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8")
const block = readme.split("<!-- list:start -->")[1].split("<!-- list:end -->")[0]
// Same slug rule as src/lib/browsers.ts, so the keys match.
const all = [...new Set([...block.matchAll(/\]\(https:\/\/github\.com\/([^/]+\/[^/#?)]+)\)/g)].map((m) => m[1]))]
const only = process.argv.slice(2)
const slugs = only.length ? all.filter((s) => only.includes(s)) : all

const token = process.env.GITHUB_TOKEN
const headers = {Accept: "application/vnd.github+json", "User-Agent": "awesome-arc-alternatives-build"}
if (token) headers.Authorization = `Bearer ${token}`

async function get(path) {
  const res = await fetch(`https://api.github.com/${path}`, {headers})
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.status === 204 ? [] : res.json() // 204: empty repo, no contributors
}

// GitHub accounts with commits, bots excluded. Paged, 100 per page, up to 1,000 people.
async function contributors(slug) {
  let people = 0
  for (let page = 1; page <= 10; page++) {
    const list = await get(`repos/${slug}/contributors?per_page=100&page=${page}`)
    people += list.filter((u) => u.type !== "Bot" && !u.login.endsWith("[bot]")).length
    if (list.length < 100) break
  }
  return people
}

const data = {}
const errors = []
await Promise.all(
  slugs.map(async (slug) => {
    try {
      const [j, n] = await Promise.all([get(`repos/${slug}`), contributors(slug).catch(() => undefined)])
      data[slug] = {p: (j.pushed_at || "").slice(0, 10), c: (j.created_at || "").slice(0, 10), s: j.stargazers_count, n}
      if (n === undefined) errors.push(`${slug}: contributors failed`)
    } catch (e) {
      errors.push(`${slug}: ${e.message}`)
    }
  }),
)
const failed = errors.length
if (failed) console.warn(`github-data: ${failed} failed, e.g. ${errors.slice(0, 3).join("; ")}`)

const out = new URL("../public/github.json", import.meta.url)
await mkdir(new URL(".", out), {recursive: true})
await writeFile(out, JSON.stringify({t: new Date().toISOString(), d: data}))
const done = Object.values(data).filter((v) => v.n !== undefined).length
console.log(`github-data: ${done}/${slugs.length} repos${token ? "" : " (no GITHUB_TOKEN, anonymous)"}`)
