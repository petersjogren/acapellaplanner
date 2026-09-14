import { marked } from 'marked'
import { Link } from 'react-router-dom'
import workflowMarkdown from '../../docs/workflow-singers-unlimited.md?raw'

// Same source the repo docs use — one file, two audiences. Parsed at import
// time (marked.parse is synchronous unless async extensions are added) so
// there is no loading state to design for.
const workflowHtml = marked.parse(workflowMarkdown, { async: false })

export function WorkflowPage() {
  return (
    <div className="min-h-screen bg-paper px-10 py-8 font-ui text-ink fade-in">
      <Link
        to="/"
        className="text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        ← Home
      </Link>
      <article
        className="doc-prose mt-6 max-w-2xl"
        // The HTML comes from our own markdown file in the repo, not user
        // input — safe to render directly.
        dangerouslySetInnerHTML={{ __html: workflowHtml }}
      />
    </div>
  )
}
