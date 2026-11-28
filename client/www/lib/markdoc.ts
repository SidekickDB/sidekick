import yaml from 'js-yaml';

// Extract frontmatter from markdoc content and separate it from the
// markdoc content
function parseFrontmatter(content: string): {
  frontmatter: any;
  content: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, content };
  }

  const frontmatterStr = match[1];
  const remainingContent = match[2];

  const frontmatter = yaml.load(frontmatterStr) || {};

  return { frontmatter, content: remainingContent };
}

// Extract attributes from a nav-button tag and convert to a markdown
// list item. Href-based buttons become `- [title](href): description`,
// param/value buttons become `- **title**: description`
function navButtonToMarkdown(tag: string): string | null {
  const href = tag.match(/href="([^"]*)"/)?.[1];
  const title = tag.match(/title="([^"]*)"/)?.[1];
  const desc = tag.match(/description="([^"]*)"/)?.[1];
  if (!title) return null;
  if (href) {
    return desc ? `- [${title}](${href}): ${desc}` : `- [${title}](${href})`;
  }
  return desc ? `- **${title}**: ${desc}` : `- **${title}**`;
}

// Convert a self-closing blank-link tag into a markdown link so the
// label/href survives in the LLM-facing export.
function blankLinkToMarkdown(tag: string): string | null {
  const href = tag.match(/href="([^"]*)"/)?.[1];
  const label = tag.match(/label="([^"]*)"/)?.[1];
  if (!label) return null;
  if (!href) return label;
  return `[${label}](${href})`;
}

// Remove `{% ... %}` tags from markdown content, converting known tags
// like nav-button into plain markdown equivalents
function sanitizeMarkdown(content: string): string {
  return content.replace(/{%[\s\S]*?%}/g, (match) => {
    if (/nav-button\s/.test(match)) {
      return navButtonToMarkdown(match) ?? '';
    }
    if (/blank-link\s/.test(match)) {
      return blankLinkToMarkdown(match) ?? '';
    }
    if (/^{%\s*dashboard-path[\s\S]*?%}$/.test(match)) {
      return '**From the dashboard**\n';
    }
    if (/^{%\s*terminal-path[\s\S]*?%}$/.test(match)) {
      return '**From the terminal**\n';
    }
    return '';
  });
}

// Transform markdoc content into a markdown format that's sanitized for
// llms
function transformContent(content: string): string {
  const { frontmatter, content: markdownContent } = parseFrontmatter(content);
  let result = '';

  const title = frontmatter.nextjs?.metadata?.title;
  const description = frontmatter.nextjs?.metadata?.description;

  if (title) {
    result += `# ${title}\n\n`;
  }

  if (description) {
    result += `${description}\n\n`;
  }

  // SidekickDB: the Markdown copies show the placeholder host that the
  // rendered docs fall back to (see components/docs/Fence.jsx), and say once
  // that it stands for the reader's server.
  const sanitized = sanitizeMarkdown(markdownContent);
  if (sanitized.includes('__API_URI__')) {
    result +=
      "The samples use `https://sidekick.example.com`: replace it with your SidekickDB server's URL.\n\n";
  }
  const sanitizedContent = sanitized.replaceAll(
    '__API_URI__',
    'https://sidekick.example.com',
  );
  return result + sanitizedContent;
}

// Strip dynamic route segments like [[...tab]] from a docs file path
function stripDynamicPaths(filePath: string): string {
  return filePath.replace(/\/\[\[\.\.\..*?\]\]/g, '');
}

// SidekickDB: where llms.txt links a page's Markdown copy. A self-hosted
// dashboard serves the copies itself, so the link is relative there;
// elsewhere it is SidekickDB's docs host with the same path.
function docsMarkdownUrl(
  href: string,
  selfHosted = process.env.NEXT_PUBLIC_SELF_HOSTED === 'true',
): string {
  return selfHosted ? `${href}.md` : `https://sidekickdb.co${href}.md`;
}

export {
  parseFrontmatter,
  transformContent,
  stripDynamicPaths,
  docsMarkdownUrl,
};
