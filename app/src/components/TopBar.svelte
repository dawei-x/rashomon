<script lang="ts">
  import { session } from '../lib/session.svelte'

  let fileInput: HTMLInputElement
  let menuOpen = $state(false)

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const text = await file.text()
    if (session.ops.length > 0 && !confirm('Loading a new file replaces the current constraints. Continue?')) return
    const r = session.loadText(text, file.name)
    session.uploadProblems = r.ok ? null : r.problems
    if (r.ok && r.warnings.length) session.showToast(r.warnings.join('; '))
  }

  function download() {
    const obj = session.exportObject()
    if (!obj) return
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${session.sourceName.replace(/\.json$/i, '') || 'modelset'}-subset.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function resetSession() {
    menuOpen = false
    if (confirm('Reset constraints, labels and notes to the initial state?')) session.resetSession()
  }
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<header>
  <h1>Rashomon Model Explorer</h1>
  {#if session.dataset}<span class="muted file">{session.dataset.name ?? session.sourceName}</span>{/if}
  <div class="spacer"></div>
  <button onclick={() => session.undo()} disabled={session.undoStack.length === 0}>Undo</button>
  <button onclick={() => session.redo()} disabled={session.redoStack.length === 0}>Redo</button>
  <button class:active={session.historyOpen} onclick={() => (session.historyOpen = !session.historyOpen)} disabled={!session.dataset}>
    History
  </button>
  <button onclick={() => fileInput.click()}>Upload JSON</button>
  <input bind:this={fileInput} type="file" accept=".json,application/json" onchange={onFile} hidden />
  <button onclick={download} disabled={session.activeCount === 0}>Download JSON</button>
  <button onclick={() => (session.helpOpen = true)}>Help</button>
  <div class="menu">
    <button
      class="icon"
      aria-label="More"
      onclick={(e) => {
        e.stopPropagation()
        menuOpen = !menuOpen
      }}>⋯</button
    >
    {#if menuOpen}
      <div class="popover menu-items">
        <button onclick={resetSession} disabled={!session.dataset}>Reset session</button>
      </div>
    {/if}
  </div>
</header>

<style>
  header {
    height: 48px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    background: var(--c-panel);
    border-bottom: 1px solid var(--c-border);
  }
  h1 {
    font-size: 16px;
    margin: 0 8px 0 0;
  }
  .file {
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .menu {
    position: relative;
  }
  .menu-items {
    right: 0;
    top: 30px;
    white-space: nowrap;
  }
</style>
