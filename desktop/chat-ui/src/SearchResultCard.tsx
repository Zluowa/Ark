interface SearchLink {
  title: string
  url: string
}

interface SearchSummary {
  answer: string
  links: SearchLink[]
}

interface Props {
  text: string
}

export function SearchResultCard({ text }: Props) {
  const summary = parseSearchSummary(text)
  if (!summary) return null

  return (
    <div className="search-card search-card-music">
      <div className="search-head">
        <div className="search-disc" />
        <div className="search-head-meta">
          <div className="search-title">Web Search</div>
          <div className="search-subtitle">{summary.links.length} sources</div>
        </div>
        <div className="search-wave" aria-hidden="true">
          <span className="search-wave-bar" />
          <span className="search-wave-bar" />
          <span className="search-wave-bar" />
        </div>
      </div>

      {summary.answer ? <div className="search-answer">{summary.answer}</div> : null}

      <div className="search-links">
        {summary.links.slice(0, 3).map((item, index) => (
          <a
            key={`${item.url}-${index}`}
            className="search-link"
            href={item.url}
            target="_blank"
            rel="noreferrer"
            title={item.url}
          >
            <span className="search-link-title">{item.title || 'Untitled'}</span>
            <span className="search-link-domain">{toHostname(item.url)}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

function parseSearchSummary(raw: string): SearchSummary | null {
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  let answer = ''
  const links: SearchLink[] = []

  for (const line of lines) {
    const answerMatch = line.match(/^Answer:\s*(.+)$/i)
    if (answerMatch) {
      answer = answerMatch[1].trim()
      continue
    }

    const numbered = line.match(/^\d+\.\s*(.+?)\s*-\s*(https?:\/\/\S+)$/i)
    if (numbered) {
      links.push({ title: numbered[1].trim(), url: numbered[2].trim() })
      continue
    }

    const bareUrl = line.match(/^(https?:\/\/\S+)$/i)
    if (bareUrl) {
      links.push({ title: 'Source', url: bareUrl[1].trim() })
      continue
    }

    if (!answer && /^(summary|answer)/i.test(line)) {
      answer = line.replace(/^(summary|answer)[:\s]*/i, '').trim()
    }
  }

  if (links.length === 0) return null
  return { answer, links }
}

function toHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
