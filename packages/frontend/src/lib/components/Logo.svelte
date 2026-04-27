<script lang="ts">
  // OpenTales mark — orange "story tree" with author at the root branching
  // outward into ideas. Renders inline so it can pick up `currentColor`
  // tinting if used in monochrome contexts (we leave the orange/brown for
  // brand fidelity).

  interface Props {
    class?: string;
    size?: number | string;
    /** Override stroke / fill — defaults to brand colors. */
    accent?: string;
    branch?: string;
  }

  let {
    class: className = '',
    size = 24,
    accent = '#d4882a',
    branch = '#7a4e18'
  }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 120 120"
  width={size}
  height={size}
  fill="none"
  class={className}
  aria-hidden="true"
>
  <circle cx="60" cy="105" r="7" fill={accent} />
  <line x1="60" y1="105" x2="60" y2="70" stroke={accent} stroke-width="2.5" stroke-linecap="round" />
  <path d="M60 70Q60 43 28 33" stroke={accent} stroke-width="2" stroke-linecap="round" />
  <path d="M60 70Q60 43 92 33" stroke={accent} stroke-width="2" stroke-linecap="round" />
  <line x1="60" y1="70" x2="60" y2="35" stroke={accent} stroke-width="2" stroke-linecap="round" />
  <path d="M28 33Q20 17 10 11" stroke={branch} stroke-width="1.5" stroke-linecap="round" />
  <path d="M28 33Q30 15 40 9" stroke={branch} stroke-width="1.5" stroke-linecap="round" />
  <path d="M60 35Q52 19 48 11" stroke={branch} stroke-width="1.5" stroke-linecap="round" />
  <path d="M60 35Q68 19 72 11" stroke={branch} stroke-width="1.5" stroke-linecap="round" />
  <path d="M92 33Q88 17 80 11" stroke={branch} stroke-width="1.5" stroke-linecap="round" />
  <path d="M92 33Q98 17 108 11" stroke={branch} stroke-width="1.5" stroke-linecap="round" />
  <circle cx="10" cy="9" r="3.5" fill={accent} />
  <circle cx="40" cy="7" r="3.5" fill={accent} />
  <circle cx="48" cy="9" r="3.5" fill={accent} />
  <circle cx="72" cy="9" r="3.5" fill={accent} />
  <circle cx="80" cy="9" r="3.5" fill={accent} />
  <circle cx="108" cy="7" r="3.5" fill={accent} />
</svg>
