import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

function MarkdownPreviewImpl({ body }: { body: string }) {
  return (
    <div className="editor-surface__preview markdown-preview">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
        {body}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownPreview = memo(MarkdownPreviewImpl);
