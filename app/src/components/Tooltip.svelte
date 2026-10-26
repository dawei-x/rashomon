<script lang="ts">
  import { session } from '../lib/session.svelte'
</script>

{#if session.tooltip}
  <div class="tooltip" style:left="{session.tooltip.x + 12}px" style:top="{session.tooltip.y + 12}px">
    {@html session.tooltip.html}
  </div>
{/if}

<style>
  .tooltip {
    position: fixed;
    z-index: 100;
    pointer-events: none;
    max-width: 360px;
    background: rgba(30, 30, 30, 0.92);
    color: white;
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 4px;
    white-space: normal;
  }
</style>
