<script lang="ts">
  import { onMount } from 'svelte'
  import { session } from './lib/session.svelte'
  import TopBar from './components/TopBar.svelte'
  import FeaturePanel from './components/FeaturePanel.svelte'
  import SpreadPanel from './components/SpreadPanel.svelte'
  import InstancePanel from './components/InstancePanel.svelte'
  import HistoryDrawer from './components/HistoryDrawer.svelte'
  import HelpModal from './components/HelpModal.svelte'
  import Tooltip from './components/Tooltip.svelte'

  let status = $state<'loading' | 'ready' | 'failed'>('loading')

  onMount(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/demo.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const r = session.loadText(await res.text(), 'demo.json')
      status = r.ok ? 'ready' : 'failed'
    } catch {
      status = 'failed'
    }
  })

  $effect(() => {
    if (session.dataset) status = 'ready'
  })
</script>

<TopBar />
{#if session.toast}
  <div class="toast">{session.toast}</div>
{/if}
{#if session.uploadProblems}
  <div class="problems">
    <strong>Could not load that file:</strong>
    <ul>
      {#each session.uploadProblems as p (p)}<li>{p}</li>{/each}
    </ul>
    <button onclick={() => (session.uploadProblems = null)}>Dismiss</button>
  </div>
{/if}

{#if status === 'ready' && session.dataset}
  <main>
    <FeaturePanel />
    <div class="right">
      <SpreadPanel />
      <InstancePanel />
    </div>
  </main>
{:else if status === 'loading'}
  <p class="empty">Loading the demo…</p>
{:else}
  <p class="empty">
    The bundled demo could not be loaded. Use <strong>Upload JSON</strong> in the top bar to open a modelset.v1 file.
  </p>
{/if}

{#if session.historyOpen}<HistoryDrawer />{/if}
{#if session.helpOpen}<HelpModal />{/if}
<Tooltip />

<style>
  main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
    padding: 10px;
    height: calc(100vh - 48px);
  }
  .right {
    display: grid;
    grid-template-rows: 55fr 45fr;
    gap: 10px;
    min-height: 0;
    min-width: 0;
  }
  .toast {
    position: fixed;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    background: var(--c-ref);
    color: white;
    padding: 6px 14px;
    border-radius: var(--radius);
  }
  .problems {
    margin: 10px 10px 0;
    padding: 8px 12px;
    background: #fdecec;
    border: 1px solid #f3b4b4;
    border-radius: var(--radius);
  }
  .problems ul {
    margin: 4px 0 8px;
  }
</style>
