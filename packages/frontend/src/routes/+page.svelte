<script lang="ts">
  import { page } from '$app/stores';
  import CTA from '$lib/components/landing/CTA.svelte';
  import EditorPreview from '$lib/components/landing/EditorPreview.svelte';
  import Features from '$lib/components/landing/Features.svelte';
  import Footer from '$lib/components/landing/Footer.svelte';
  import Hero from '$lib/components/landing/Hero.svelte';
  import Nav from '$lib/components/landing/Nav.svelte';
  import Stats from '$lib/components/landing/Stats.svelte';
  import Workflow from '$lib/components/landing/Workflow.svelte';

  const title = 'OpenTales — The IDE for novelists';
  const description =
    'Write chapters, build characters, and map plot structure in one distraction-free workspace. Open-source novel-writing IDE powered by Monaco.';
  const ogImagePath = '/og-banner.png';
  // Public canonical site URL used as a fallback during prerender (when
  // there's no real request). Gets overridden client-side from $page.url.
  const SITE_URL = 'https://opentales.app';

  let origin = $derived(
    $page.url.origin && !$page.url.origin.includes('sveltekit-prerender')
      ? $page.url.origin
      : SITE_URL
  );
  let canonical = $derived(`${origin}${$page.url.pathname || '/'}`);
  let ogImageUrl = $derived(`${origin}${ogImagePath}`);
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonical} />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="OpenTales" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={ogImageUrl} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="OpenTales — the IDE for novelists" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={ogImageUrl} />

  <!-- Structured data -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenTales',
    description,
    applicationCategory: 'WritingApplication',
    operatingSystem: 'Web, macOS, Linux, Windows',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
  })}</` + `script>`}
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
  <Nav />
  <main>
    <Hero />
    <Stats />
    <Features />
    <Workflow />
    <EditorPreview />
    <CTA />
  </main>
  <Footer />
</div>
