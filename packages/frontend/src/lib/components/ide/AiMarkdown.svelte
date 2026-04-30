<script lang="ts">
  interface Props {
    content: string;
    streaming?: boolean;
  }

  let { content, streaming = false }: Props = $props();
  const html = $derived(renderMarkdown(content));

  function renderMarkdown(markdown: string): string {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const out: string[] = [];
    let listOpen = false;
    let codeOpen = false;
    let codeLines: string[] = [];
    let paragraph: string[] = [];

    const closeParagraph = () => {
      if (paragraph.length === 0) return;
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listOpen) return;
      out.push('</ul>');
      listOpen = false;
    };
    const closeCode = () => {
      if (!codeOpen) return;
      out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      codeLines = [];
      codeOpen = false;
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (codeOpen) closeCode();
        else {
          closeParagraph();
          closeList();
          codeOpen = true;
        }
        continue;
      }
      if (codeOpen) {
        codeLines.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        closeParagraph();
        closeList();
        continue;
      }

      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        closeParagraph();
        closeList();
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
        continue;
      }

      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        closeParagraph();
        if (!listOpen) {
          out.push('<ul>');
          listOpen = true;
        }
        out.push(`<li>${inline(bullet[1] ?? '')}</li>`);
        continue;
      }

      paragraph.push(trimmed);
    }

    closeCode();
    closeParagraph();
    closeList();
    return out.join('');
  }

  function inline(value: string): string {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
</script>

<div class="ai-markdown text-xs leading-relaxed text-foreground/90" class:streaming>{@html html}</div>

<style>
  .ai-markdown :global(p) { margin: 0.45rem 0; }
  .ai-markdown :global(p:first-child) { margin-top: 0; }
  .ai-markdown :global(p:last-child) { margin-bottom: 0; }
  .ai-markdown :global(h1),
  .ai-markdown :global(h2),
  .ai-markdown :global(h3),
  .ai-markdown :global(h4) { margin: 0.7rem 0 0.3rem; font-size: 0.78rem; font-weight: 650; color: hsl(var(--foreground)); }
  .ai-markdown :global(ul) { margin: 0.4rem 0; padding-left: 1rem; }
  .ai-markdown :global(li) { margin: 0.18rem 0; }
  .ai-markdown :global(code) { border-radius: 0.25rem; background: hsl(var(--muted) / 0.65); padding: 0.05rem 0.25rem; font-size: 0.72rem; }
  .ai-markdown :global(pre) { margin: 0.55rem 0; max-height: 16rem; overflow: auto; border: 1px solid hsl(var(--border)); border-radius: 0.45rem; background: hsl(var(--muted) / 0.35); padding: 0.65rem; }
  .ai-markdown :global(pre code) { background: transparent; padding: 0; white-space: pre-wrap; }
  .ai-markdown :global(a) { color: hsl(var(--accent)); text-decoration: underline; text-underline-offset: 2px; }
</style>
