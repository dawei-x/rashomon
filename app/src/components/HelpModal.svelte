<script lang="ts">
  import { session } from '../lib/session.svelte'

  const ds = $derived(session.dataset)
  const meta = $derived(Object.entries(ds?.meta ?? {}))
  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (session.helpOpen = false)} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={() => (session.helpOpen = false)}>
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Help" tabindex="-1">
    <div class="head">
      <h2>ModelSet Explorer</h2>
      <button class="icon" aria-label="Close" onclick={() => (session.helpOpen = false)}>×</button>
    </div>

    <p>
      The file holds a <em>model set</em>: many additive classification models that are all nearly equally accurate on the same
      data. They can still disagree about how a feature matters and about individual predictions. This tool lets you see those
      disagreements and narrow the set down with domain knowledge.
    </p>
    <h3>Feature curves (left)</h3>
    <p>
      For every feature, each model's curve shows how much that feature adds to the model's score at each value. Grey lines are
      the models that satisfy your constraints, the dark line is the reference model (lowest loss among them), pink is the
      selected model. The histogram above each curve shows the data. Features are ordered by the smallest importance any model
      gives them, so the top features matter to every model.
    </p>
    <h3>Predicted probability by instance (top right)</h3>
    <p>
      Instances are sorted by the reference model's prediction; every model draws one line. The caption reports how many
      instances would get a different yes/no decision at the threshold depending on which model you pick; red ticks under the
      axis mark them.
    </p>
    <h3>Instance (bottom right)</h3>
    <p>
      For the clicked instance, each feature's contribution under the reference model, the lowest- and highest-prediction models,
      and the selected model, with the full formula for each.
    </p>

    <h3>Interactions</h3>
    <ul>
      <li><strong>↗ button</strong> on a feature card cycles none → monotone increasing → monotone decreasing.</li>
      <li><strong>Dashed-square button</strong> enters rectangle mode: drag a box on the curve plot, then keep only or exclude the models whose curves pass through it.</li>
      <li>Hover a curve to see its model; click it to select that model everywhere. Click it again to clear.</li>
      <li>Drag across the prediction plot to zoom into a rank range; click it to inspect an instance. Drag the red threshold pill, or double-click it to type a value.</li>
      <li><strong>History</strong> lists every constraint: disable, delete, edit its rationale, or remove everything added after it. Undo/Redo step through these changes.</li>
      <li><strong>+ label</strong> and the notes button annotate a feature; the Labels tab lists all annotations.</li>
      <li>Your constraints, labels, notes and threshold are saved in this browser for this file. <strong>Clear session</strong> (⋯ menu) forgets them.</li>
    </ul>

    <h3>Export and import</h3>
    <p>
      <strong>Download JSON</strong> saves a file with only the models that currently satisfy the constraints, plus your labels,
      notes, threshold and constraint list. Loading that file starts a new baseline: annotations and threshold come back, the old
      constraints are listed read-only under "Inherited" in History, and you get a fresh, editable history over the exported
      models. Models that were not exported cannot be brought back from it.
    </p>

    <h3>About this file</h3>
    {#if ds}
      <p><strong>{ds.name ?? session.sourceName}</strong> <span class="muted">({session.sourceName})</span></p>
      <table>
        <tbody>
          {#each meta as [k, v] (k)}
            <tr><td class="mono">{k}</td><td>{show(v)}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--c-panel);
    border-radius: var(--radius);
    width: 720px;
    max-height: 85vh;
    overflow-y: auto;
    padding: 16px 24px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0;
  }
  h3 {
    font-size: 13px;
    margin: 16px 0 4px;
  }
  p {
    margin: 4px 0;
  }
  table {
    border-collapse: collapse;
    font-size: 12px;
  }
  td {
    padding: 2px 8px 2px 0;
    vertical-align: top;
    word-break: break-word;
  }
</style>
