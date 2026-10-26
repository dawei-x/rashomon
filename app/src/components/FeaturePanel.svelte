<script lang="ts">
  import { tick } from 'svelte'
  import { session } from '../lib/session.svelte'
  import FeatureCard from './FeatureCard.svelte'
  import HelpTip from './HelpTip.svelte'

  let tab = $state<'curves' | 'labels'>('curves')
  const ds = $derived(session.dataset!)
  const prep = $derived(session.prep!)

  async function jumpTo(j: number) {
    tab = 'curves'
    await tick()
    document.getElementById(`card-${j}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
</script>

<section class="panel">
  <div class="panel-header">
    <h2>Feature curves</h2>
    <HelpTip
      text="Each plot shows one feature's contribution (y) across its values (x) for every model that satisfies the constraints: grey lines are models, the dark line is the reference (lowest-loss) model, pink is the selected model. The histogram above shows the data. Use the buttons on the left of a card to add a monotone constraint or draw a rectangle filter."
    />
    <div class="tabs">
      <button class:active={tab === 'curves'} onclick={() => (tab = 'curves')}>Curves</button>
      <button class:active={tab === 'labels'} onclick={() => (tab = 'labels')}>Labels</button>
    </div>
    <span class="count">{session.activeCount}/{prep.N} model(s) satisfy the constraints specified</span>
  </div>

  <div class="scroll">
    {#if tab === 'curves'}
      <div class="grid">
        {#each prep.featureOrder as j (j)}
          <FeatureCard {j} />
        {/each}
      </div>
    {:else}
      <table>
        <thead><tr><th>Feature</th><th>Labels</th><th>Note</th></tr></thead>
        <tbody>
          {#each prep.featureOrder as j (j)}
            {@const name = ds.features[j].name}
            <tr onclick={() => jumpTo(j)}>
              <td><span class="chip mono">{name}</span></td>
              <td>
                {#each session.labels[name] ?? [] as l (l)}<span class="chip">{l}</span>{' '}{/each}
              </td>
              <td class="muted">{(session.notes[name] ?? '').split('\n')[0]}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</section>

<style>
  .tabs {
    display: flex;
    margin-left: 8px;
  }
  .tabs button {
    border-radius: 0;
    padding: 2px 10px;
  }
  .tabs button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .tabs button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
    border-left: none;
  }
  .count {
    margin-left: auto;
    color: var(--c-muted);
  }
  .scroll {
    overflow-y: auto;
    padding: 8px;
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    gap: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-weight: 600;
    border-bottom: 1px solid var(--c-border);
    padding: 4px 6px;
  }
  td {
    padding: 4px 6px;
    border-bottom: 1px solid #f0f0f0;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: var(--c-hover);
  }
</style>
