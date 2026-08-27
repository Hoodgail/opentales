<script lang="ts">
  interface Props {
    src: string;
    alt: string;
    label: string;
    caption: string;
    video?: boolean;
    poster?: string;
  }

  let { src, alt, label, caption, video = false, poster }: Props = $props();
</script>

<figure class="overflow-hidden rounded-lg border border-border/80 bg-panel shadow-2xl shadow-black/30">
  <div class="flex h-9 items-center justify-between border-b border-border/70 bg-sidebar px-3">
    <div class="flex items-center gap-1.5" aria-hidden="true">
      <span class="size-2.5 rounded-full bg-destructive/70"></span>
      <span class="size-2.5 rounded-full bg-accent/80"></span>
      <span class="size-2.5 rounded-full bg-[oklch(0.65_0.15_145)]/70"></span>
    </div>
    <div class="truncate px-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
      {label}
    </div>
    <div class="w-10 text-right font-mono text-[9px] text-muted-foreground/60">
      {video ? 'clip' : 'view'}
    </div>
  </div>

  <div class="bg-sidebar">
    {#if video}
      <video
        class="block aspect-[8/5] w-full bg-sidebar object-cover"
        controls
        muted
        loop
        playsinline
        preload="metadata"
        {poster}
        aria-label={alt}
      >
        <source {src} type="video/mp4" />
      </video>
    {:else}
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        class="block outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        aria-label={`Open full-size image: ${alt}`}
      >
        <img
          {src}
          {alt}
          loading="lazy"
          decoding="async"
          class="block aspect-[8/5] w-full object-cover"
        />
      </a>
    {/if}
  </div>

  <figcaption class="flex items-start gap-3 border-t border-border/70 bg-panel/80 px-4 py-3">
    <span class="mt-0.5 shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-accent">
      Live UI
    </span>
    <span class="text-xs leading-relaxed text-muted-foreground">{caption}</span>
  </figcaption>
</figure>
