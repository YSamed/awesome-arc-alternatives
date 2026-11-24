// Fetches stars, the latest push date and the creation date for every GitHub repo in
// the README table, and writes them to public/github.json. The page reads that file,
// so visitors make no GitHub API calls and never hit the anonymous rate limit.
//
// The deploy workflow runs it before `pnpm build`, with the workflow's GITHUB_TOKEN
// (1,000 requests per hour per repo). Run it locally with `pnpm github-data`; without
// a token it falls back to anonymous requests, limited to 60 per hour. A failed repo
// is skipped and never fails the run: the page then fetches that one repo live.
import {mkdir, readFile, writeFile} from "node:fs/promises"

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8")
const block = readme.split("<!-- list:start -->")[1].split("<!-- list:end -->")[0]
// Same slug rule as src/lib/browsers.ts, so the keys match.
const slugs = [...new Set([...block.matchAll(/\]\(https:\/\/github\.com\/([^/]+\/[^/#?)]+)\)/g)].map((m) => m[1]))]

const token = process.env.GITHUB_TOKEN
const headers = {Accept: "application/vnd.github+json", "User-Agent": "awesome-arc-alternatives-build"}
if (token) headers.Authorization = `Bearer ${token}`

const data = {}
const errors = []
await Promise.all(
  slugs.map(async (slug) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${slug}`, {headers})
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      data[slug] = {p: (j.pushed_at || "").slice(0, 10), c: (j.created_at || "").slice(0, 10), s: j.stargazers_count}
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
console.log(`github-data: ${slugs.length - failed}/${slugs.length} repos${token ? "" : " (no GITHUB_TOKEN, anonymous)"}`)
