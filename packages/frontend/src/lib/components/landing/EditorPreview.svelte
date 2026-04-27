<script lang="ts">
  import { BookOpen, FileText, Folder, MapPin, Search, Settings, Users } from 'lucide-svelte';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type IconLike = any;

  const treeRows: { icon: IconLike; label: string; active?: boolean; muted?: boolean; indent?: boolean }[] = [
    { icon: Folder, label: 'Act I — Inheritance', muted: true },
    { icon: FileText, label: 'Prologue: The Letter', indent: true },
    { icon: FileText, label: 'The House That Waited', indent: true, active: true },
    { icon: FileText, label: 'Cipher in the Stacks', indent: true },
    { icon: FileText, label: 'Crane at the Door', indent: true },
    { icon: Folder, label: 'Act II — The Cipher', muted: true },
    { icon: FileText, label: 'The Locked Study', indent: true },
    { icon: FileText, label: 'Things Marcus Knew', indent: true },
    { icon: Folder, label: 'Act III — Reckoning', muted: true }
  ];

  const proseLines: { html: string; blank?: boolean }[] = [
    { html: '<span class="text-accent"># Chapter 1: The House That Waited</span>' },
    { html: '', blank: true },
    { html: 'The key her grandmother had sent — heavy iron, longer than her hand —' },
    { html: 'turned in the lock with a sound like a small bone breaking.' },
    { html: '', blank: true },
    { html: 'The door opened on its own weight. Elena stepped inside.' },
    { html: '', blank: true },
    { html: 'The foyer smelled exactly as she remembered: lavender oil, old paper,' },
    { html: 'the faintest edge of woodsmoke from a fire that had been out for years.' },
    { html: '', blank: true },
    { html: '<span class="text-foreground/95">&ldquo;You took your time.&rdquo;</span>' },
    { html: '', blank: true },
    { html: 'The voice came from the library doorway. A man, tall, gray-bearded,' },
    { html: 'holding a glass of something amber. Marcus Hale.' }
  ];
</script>

<section id="editor" class="border-b border-border/60 bg-background">
  <div class="mx-auto w-full max-w-6xl px-6 py-20">
    <!-- window chrome -->
    <div
      class="overflow-hidden rounded-lg border border-border/80 bg-panel shadow-2xl shadow-black/40"
    >
      <!-- title bar -->
      <div
        class="flex h-9 items-center justify-between border-b border-border/60 bg-sidebar px-3"
      >
        <div class="flex items-center gap-1.5">
          <span class="h-3 w-3 rounded-full bg-[oklch(0.55_0.18_25)]/80"></span>
          <span class="h-3 w-3 rounded-full bg-accent/80"></span>
          <span class="h-3 w-3 rounded-full bg-[oklch(0.65_0.15_145)]/80"></span>
        </div>
        <div class="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span>The Blackwood Cipher</span>
          <span class="text-muted-foreground/50">—</span>
          <span>Literary Mystery</span>
        </div>
        <div class="w-12"></div>
      </div>

      <div class="flex h-[460px]">
        <!-- activity bar -->
        <div
          class="flex w-12 flex-col items-center gap-1 border-r border-border/60 bg-sidebar py-3"
        >
          <div
            class="flex h-9 w-9 items-center justify-center rounded-sm border-l-2 border-accent text-foreground"
          >
            <FileText class="h-4 w-4" />
          </div>
          <div
            class="flex h-9 w-9 items-center justify-center rounded-sm border-l-2 border-transparent text-muted-foreground"
          >
            <Users class="h-4 w-4" />
          </div>
          <div
            class="flex h-9 w-9 items-center justify-center rounded-sm border-l-2 border-transparent text-muted-foreground"
          >
            <MapPin class="h-4 w-4" />
          </div>
          <div
            class="flex h-9 w-9 items-center justify-center rounded-sm border-l-2 border-transparent text-muted-foreground"
          >
            <BookOpen class="h-4 w-4" />
          </div>
          <div
            class="flex h-9 w-9 items-center justify-center rounded-sm border-l-2 border-transparent text-muted-foreground"
          >
            <Search class="h-4 w-4" />
          </div>
          <div class="mt-auto">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-sm border-l-2 border-transparent text-muted-foreground"
            >
              <Settings class="h-4 w-4" />
            </div>
          </div>
        </div>

        <!-- explorer -->
        <div class="hidden w-56 shrink-0 border-r border-border/60 bg-sidebar/60 sm:block">
          <div
            class="flex h-9 items-center justify-between border-b border-border/60 px-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Manuscript
          </div>
          <div class="px-1.5 py-2 font-mono text-[12px]">
            {#each treeRows as r (r.label)}
              <div
                class={
                  'flex items-center gap-2 rounded-sm px-2 py-1 ' +
                  (r.indent ? 'pl-5 ' : '') +
                  (r.active
                    ? 'bg-background text-foreground'
                    : r.muted
                      ? 'text-muted-foreground'
                      : 'text-foreground/80')
                }
              >
                <r.icon class={'h-3.5 w-3.5 ' + (r.muted ? 'text-accent' : '')} />
                <span class="truncate">{r.label}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- editor -->
        <div class="flex flex-1 flex-col bg-background">
          <!-- tab strip -->
          <div class="flex h-9 items-center border-b border-border/60 bg-sidebar/60 px-1">
            <div
              class="flex h-full items-center gap-2 border-r border-border/60 bg-background px-3 font-mono text-[12px]"
            >
              <FileText class="h-3.5 w-3.5 text-muted-foreground" />
              <span>The House That Waited</span>
              <span class="ml-1 h-1.5 w-1.5 rounded-full bg-accent"></span>
            </div>
          </div>

          <!-- breadcrumb -->
          <div
            class="flex h-8 items-center gap-2 border-b border-border/60 bg-background px-4 font-mono text-[11px] text-muted-foreground"
          >
            <span>#</span>
            <span>Chapter 01</span>
            <span class="text-muted-foreground/50">/</span>
            <span class="text-foreground">The House That Waited</span>
            <span
              class="ml-2 rounded border border-border/60 px-1 py-px text-[9px] uppercase tracking-wider text-accent/90"
            >
              writing
            </span>
            <span class="ml-auto text-muted-foreground/70">POV: Elena Voss</span>
          </div>

          <!-- code-styled prose -->
          <div class="flex flex-1 overflow-hidden font-mono text-[12px] leading-6">
            <!-- line numbers -->
            <div
              class="select-none border-r border-border/60 bg-background px-3 py-3 text-right text-muted-foreground/50"
            >
              {#each proseLines as _, i (i)}
                <div>{i + 1}</div>
              {/each}
            </div>
            <!-- content -->
            <div class="flex-1 overflow-hidden px-4 py-3">
              {#each proseLines as line, i (i)}
                <div class="min-h-[1.5rem]">
                  {#if !line.blank}
                    {@html line.html}
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </div>

        <!-- inspector -->
        <div class="hidden w-56 shrink-0 border-l border-border/60 bg-panel md:block">
          <div
            class="flex h-9 items-center justify-between border-b border-border/60 px-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            <span>Inspector</span>
            <span>chapter</span>
          </div>
          <div class="space-y-4 p-3">
            <div>
              <div
                class="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Chapter
              </div>
              <div class="space-y-1.5 rounded border border-border/60 bg-sidebar/60 p-2 text-[12px]">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Number</span>
                  <span>Ch. 1</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Status</span>
                  <span class="text-accent">in-progress</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Words</span>
                  <span>3,210</span>
                </div>
              </div>
            </div>
            <div>
              <div
                class="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Connections
              </div>
              <div class="flex items-center gap-2 rounded border border-border/60 bg-sidebar/60 p-2">
                <div
                  class="h-7 w-7 rounded-sm bg-gradient-to-br from-accent/30 to-accent/10"
                ></div>
                <div class="min-w-0">
                  <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    POV
                  </div>
                  <div class="truncate text-[12px]">Elena Voss</div>
                </div>
              </div>
              <div class="mt-2 flex items-center gap-2 rounded border border-border/60 bg-sidebar/60 p-2">
                <div
                  class="h-7 w-7 rounded-sm bg-gradient-to-br from-foreground/15 to-foreground/5"
                ></div>
                <div class="min-w-0">
                  <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Setting
                  </div>
                  <div class="truncate text-[12px]">Blackwood Manor</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- status bar -->
      <div
        class="flex h-7 items-center justify-between border-t border-border/60 bg-sidebar px-3 font-mono text-[10px] text-muted-foreground"
      >
        <div class="flex items-center gap-4">
          <span>main</span>
          <span>0 issues</span>
          <span class="hidden sm:inline">The Blackwood Cipher</span>
        </div>
        <div class="flex items-center gap-4">
          <span>3,210 words</span>
          <span class="hidden sm:inline">Markdown</span>
          <span class="hidden md:inline">UTF-8</span>
          <span>Synced</span>
        </div>
      </div>
    </div>
  </div>
</section>
