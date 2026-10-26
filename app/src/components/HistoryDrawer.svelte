<script lang="ts">
  import { session } from '../lib/session.svelte'
  import { describeOp, type ProvenanceEntry } from '../lib/constraints'

  let editing = $state<string | null>(null)
  const rows = $derived([...session.ops].reverse())
  const inherited = $derived.by(() => {
    const groups = new Map<string, ProvenanceEntry[]>()
    for (const p of session.provenance) groups.set(p.fromFile, [...(groups.get(p.fromFile) ?? []), p])
    return [...groups]
  })

  function save(id: string, e: Event) {
    session.setRationale(id, (e.currentTarget as HTMLInputElement).value.trim())
    editing = null
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && editing === null && (session.historyOpen = false)} />

<aside class="drawer">
  <div class="panel-header">
    <h2>Constraint history</h2>
    <button class="icon close" aria-label="Close" onclick={() => (session.historyOpen = false)}>×</button>
  </div>
  <div class="list">
    {#each rows as op (op.id)}
      <div class="row" class:disabled={!op.enabled}>
        <div class="line">
          <span class="mono id">{op.id}</span>
          <span class="desc">{describeOp(op)}</span>
        </div>
        {#if editing === op.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="rationale-input"
            value={op.rationale ?? ''}
            placeholder="rationale"
            autofocus
            onblur={(e) => save(op.id, e)}
            onkeydown={(e) => e.key === 'Enter' && save(op.id, e)}
          />
        {:else}
          <button class="link rationale" onclick={() => (editing = op.id)}>{op.rationale || 'add rationale'}</button>
        {/if}
        <div class="actions">
          <button onclick={() => session.removeLater(op.id)} title="Remove every constraint added after this one">Remove later constraints</button>
          <button class="icon" onclick={() => session.toggleOp(op.id)} title={op.enabled ? 'Disable' : 'Enable'} aria-label={op.enabled ? 'Disable' : 'Enable'}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" /><circle cx="8" cy="8" r="2" />
              {#if op.enabled}<path d="M2 14 14 2" />{/if}
            </svg>
          </button>
          <button class="icon" onclick={() => session.deleteOp(op.id)} title="Delete" aria-label="Delete">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"><path d="M2 3.5h10M5 3.5V2h4v1.5M3.5 3.5l.7 8.5h5.6l.7-8.5" /></svg>
          </button>
        </div>
      </div>
    {/each}
    <div class="row">
      <div class="line">
        <span class="mono id">initial</span>
        <span class="desc">initial state — all {session.prep?.N ?? 0} models</span>
      </div>
      <div class="actions">
        <button onclick={() => session.removeLater('initial')} disabled={session.ops.length === 0}>Remove later constraints</button>
      </div>
    </div>

    {#each inherited as [file, entries] (file)}
      <details class="inherited">
        <summary>Inherited from {file} ({entries.length})</summary>
        {#each entries as p, k (k)}
          <div class="row" class:disabled={!p.enabled}>
            <div class="desc">{p.description}</div>
            {#if p.rationale}<div class="muted small">{p.rationale}</div>{/if}
          </div>
        {/each}
      </details>
    {/each}
  </div>
</aside>

<style>
  .drawer {
    position: fixed;
    top: 48px;
    right: 0;
    bottom: 0;
    width: 400px;
    z-index: 30;
    background: var(--c-panel);
    border-left: 1px solid var(--c-border);
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
  }
  .close {
    margin-left: auto;
    border: none;
  }
  .list {
    overflow-y: auto;
    padding: 8px 12px;
  }
  .row {
    border-bottom: 1px solid #eee;
    padding: 6px 0;
  }
  .line {
    display: flex;
    gap: 8px;
  }
  .id {
    color: var(--c-muted);
  }
  .disabled .desc {
    text-decoration: line-through;
    color: var(--c-muted);
  }
  .rationale {
    font-size: 11px;
    color: var(--c-muted);
    text-decoration: none;
    text-align: left;
  }
  .rationale-input {
    width: 100%;
    font-size: 11px;
  }
  .actions {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }
  .actions button:first-child {
    font-size: 11px;
    padding: 2px 8px;
  }
  .inherited {
    margin-top: 12px;
  }
  .inherited summary {
    cursor: pointer;
    font-weight: 600;
  }
  .small {
    font-size: 11px;
  }
</style>
