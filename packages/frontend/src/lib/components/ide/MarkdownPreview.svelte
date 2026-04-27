<script lang="ts">
  interface Props {
    content: string;
  }

  let { content }: Props = $props();

  type Block =
    | { kind: 'h1' | 'h2' | 'h3'; text: string }
    | { kind: 'p'; text: string }
    | { kind: 'quote'; lines: string[] }
    | { kind: 'hr' }
    | { kind: 'note'; text: string };

  const blocks = $derived.by<Block[]>(() => {
    const out: Block[] = [];
    const paragraph: string[] = [];
    let blockquote: string[] = [];

    const flushParagraph = () => {
      if (paragraph.length) {
        out.push({ kind: 'p', text: paragraph.join(' ') });
        paragraph.length = 0;
      }
    };
    const flushQuote = () => {
      if (blockquote.length) {
        out.push({ kind: 'quote', lines: blockquote });
        blockquote = [];
      }
    };

    for (const raw of content.split('\n')) {
      const line = raw.trimEnd();
      if (line.startsWith('# ')) {
        flushParagraph();
        flushQuote();
        out.push({ kind: 'h1', text: line.slice(2) });
      } else if (line.startsWith('## ')) {
        flushParagraph();
        flushQuote();
        out.push({ kind: 'h2', text: line.slice(3) });
      } else if (line.startsWith('### ')) {
        flushParagraph();
        flushQuote();
        out.push({ kind: 'h3', text: line.slice(4) });
      } else if (line.startsWith('> ')) {
        flushParagraph();
        blockquote.push(line.slice(2));
      } else if (line.trim() === '---') {
        flushParagraph();
        flushQuote();
        out.push({ kind: 'hr' });
      } else if (line.trim() === '') {
        flushParagraph();
        flushQuote();
      } else if (line.startsWith('[')) {
        flushParagraph();
        flushQuote();
        out.push({ kind: 'note', text: line });
      } else {
        flushQuote();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushQuote();
    return out;
  });

  function renderInline(text: string): { type: 'text' | 'strong' | 'em'; value: string }[] {
    const parts: { type: 'text' | 'strong' | 'em'; value: string }[] = [];
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) parts.push({ type: 'text', value: text.slice(lastIdx, match.index) });
      const m = match[0];
      if (m.startsWith('**')) parts.push({ type: 'strong', value: m.slice(2, -2) });
      else parts.push({ type: 'em', value: m.slice(1, -1) });
      lastIdx = match.index + m.length;
    }
    if (lastIdx < text.length) parts.push({ type: 'text', value: text.slice(lastIdx) });
    return parts;
  }
</script>

<article class="mx-auto max-w-prose">
  {#each blocks as b, i (i)}
    {#if b.kind === 'h1'}
      <h1 class="mb-4 mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
        {b.text}
      </h1>
    {:else if b.kind === 'h2'}
      <h2 class="mb-3 mt-6 font-serif text-xl font-semibold text-foreground">{b.text}</h2>
    {:else if b.kind === 'h3'}
      <h3 class="mb-2 mt-4 font-serif text-base font-semibold text-foreground">{b.text}</h3>
    {:else if b.kind === 'p'}
      <p class="mb-4 leading-relaxed text-foreground/90">
        {#each renderInline(b.text) as part, j (j)}
          {#if part.type === 'strong'}
            <strong class="font-semibold text-foreground">{part.value}</strong>
          {:else if part.type === 'em'}
            <em class="italic">{part.value}</em>
          {:else}
            {part.value}
          {/if}
        {/each}
      </p>
    {:else if b.kind === 'quote'}
      <blockquote class="mb-4 border-l-2 border-accent/60 pl-4 italic text-foreground/80">
        {#each b.lines as line, k (k)}
          <p class="mb-2 last:mb-0">
            {#each renderInline(line) as part, j (j)}
              {#if part.type === 'strong'}
                <strong class="font-semibold text-foreground">{part.value}</strong>
              {:else if part.type === 'em'}
                <em class="italic">{part.value}</em>
              {:else}
                {part.value}
              {/if}
            {/each}
          </p>
        {/each}
      </blockquote>
    {:else if b.kind === 'hr'}
      <hr class="my-6 border-border" />
    {:else if b.kind === 'note'}
      <div
        class="mb-3 rounded border border-dashed border-border bg-muted/40 px-3 py-2 text-xs italic text-muted-foreground"
      >
        {b.text}
      </div>
    {/if}
  {/each}
</article>
