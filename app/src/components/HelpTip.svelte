<script lang="ts">
  import { session } from '../lib/session.svelte'
  import { escapeHtml } from '../lib/format'

  let { text }: { text: string } = $props()
</script>

<span
  class="help"
  role="img"
  aria-label={text}
  onmousemove={(e) => (session.tooltip = { x: e.clientX, y: e.clientY, html: escapeHtml(text) })}
  onmouseleave={() => (session.tooltip = null)}>?</span
>

<style>
  .help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1px solid var(--c-muted);
    color: var(--c-muted);
    font-size: 10px;
    cursor: help;
  }
</style>
